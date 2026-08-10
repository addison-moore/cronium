package ssh

import (
	"net"
	"sync"
	"testing"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

// fakeConn is the minimum ssh.Conn needed to build a real *ssh.Client without a
// network peer, so a test can observe whether the pool closed it.
type fakeConn struct {
	mu     sync.Mutex
	closed bool
	done   chan struct{}
}

func newFakeConn() *fakeConn {
	return &fakeConn{done: make(chan struct{})}
}

func (c *fakeConn) User() string          { return "test" }
func (c *fakeConn) SessionID() []byte     { return []byte("session") }
func (c *fakeConn) ClientVersion() []byte { return []byte("SSH-2.0-test") }
func (c *fakeConn) ServerVersion() []byte { return []byte("SSH-2.0-test") }
func (c *fakeConn) RemoteAddr() net.Addr  { return &net.TCPAddr{IP: net.IPv4zero, Port: 22} }
func (c *fakeConn) LocalAddr() net.Addr   { return &net.TCPAddr{IP: net.IPv4zero, Port: 0} }

func (c *fakeConn) SendRequest(string, bool, []byte) (bool, []byte, error) {
	return false, nil, nil
}

func (c *fakeConn) OpenChannel(string, []byte) (ssh.Channel, <-chan *ssh.Request, error) {
	return nil, nil, nil
}

func (c *fakeConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.done)
	}
	return nil
}

func (c *fakeConn) Wait() error {
	<-c.done
	return nil
}

func (c *fakeConn) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func newFakeClient() (*ssh.Client, *fakeConn) {
	fc := newFakeConn()
	chans := make(chan ssh.NewChannel)
	reqs := make(chan *ssh.Request)
	close(chans)
	close(reqs)
	return ssh.NewClient(fc, chans, reqs), fc
}

func putTestPool() *ConnectionPool {
	return &ConnectionPool{
		log:         logrus.New(),
		connections: make(map[string]*poolEntry),
		breakers:    make(map[string]*CircuitBreaker),
	}
}

// When two jobs target the same server concurrently, Get dials a second
// connection and addConnection overwrites the pool entry. The first client is
// then unreachable from p.connections, so returning it must close it — otherwise
// its socket and goroutines leak for the life of the process.
func TestPutClosesConnectionDisplacedByConcurrentGet(t *testing.T) {
	pool := putTestPool()
	const id = "ssh:identity"

	first, firstConn := newFakeClient()
	second, secondConn := newFakeClient()

	// Job A pooled its connection...
	pool.addConnection(id, first)
	// ...then job B, finding it in use, dialed its own and displaced it.
	pool.addConnection(id, second)

	// Job A finishes and hands its now-orphaned client back.
	pool.Put(id, first, true)

	assert.True(t, firstConn.isClosed(),
		"displaced connection must be closed, not silently dropped")
	assert.False(t, secondConn.isClosed(),
		"the connection currently owning the pool entry must be left alone")

	entry, exists := pool.connections[id]
	require.True(t, exists, "pool entry must survive the displaced return")
	assert.Same(t, second, entry.conn, "pool entry must still point at the live connection")
	assert.True(t, entry.inUse, "job B is still using its connection")
}

// A connection returned under an identity the pool has already evicted (idle
// sweep, unhealthy peer) has no owner either, so it must be closed.
func TestPutClosesConnectionWithNoPoolEntry(t *testing.T) {
	pool := putTestPool()
	client, conn := newFakeClient()

	pool.Put("ssh:never-pooled", client, true)

	assert.True(t, conn.isClosed(), "connection with no pool entry must be closed")
}

// The ordinary path is unchanged: a healthy connection parks for reuse.
func TestPutParksHealthyConnectionForReuse(t *testing.T) {
	pool := putTestPool()
	const id = "ssh:identity"
	client, conn := newFakeClient()

	pool.addConnection(id, client)
	pool.Put(id, client, true)

	assert.False(t, conn.isClosed(), "healthy connection must stay open for reuse")
	entry, exists := pool.connections[id]
	require.True(t, exists)
	assert.False(t, entry.inUse, "connection must be marked free")
	assert.True(t, entry.healthy)
	assert.WithinDuration(t, time.Now(), entry.lastUsed, time.Minute)
}

// An unhealthy return still closes and evicts.
func TestPutClosesAndEvictsUnhealthyConnection(t *testing.T) {
	pool := putTestPool()
	const id = "ssh:identity"
	client, conn := newFakeClient()

	pool.addConnection(id, client)
	pool.Put(id, client, false)

	assert.True(t, conn.isClosed(), "unhealthy connection must be closed")
	_, exists := pool.connections[id]
	assert.False(t, exists, "unhealthy connection must be evicted from the pool")
}
