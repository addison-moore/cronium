package ssh

import (
	"crypto/sha256"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

func identityTestPool() *ConnectionPool {
	pool := &ConnectionPool{
		log:         logrus.New(),
		connections: make(map[string]*poolEntry),
		breakers:    make(map[string]*CircuitBreaker),
	}
	for index := range pool.identityKey {
		pool.identityKey[index] = byte(index + 1)
	}
	return pool
}

func cloneServerDetails(server *types.ServerDetails) *types.ServerDetails {
	clone := *server
	return &clone
}

func TestConnectionIdentityIncludesAuthenticationBoundary(t *testing.T) {
	pool := identityTestPool()
	base := &types.ServerDetails{
		ID:         "server-1",
		Host:       "shared.example.com",
		Port:       22,
		Username:   "deploy",
		Password:   "victim-password",
		PrivateKey: "victim-private-key",
		Passphrase: "victim-passphrase",
	}
	baseIdentity := pool.connectionIdentity(base)

	tests := []struct {
		name   string
		mutate func(*types.ServerDetails)
	}{
		{name: "server record", mutate: func(server *types.ServerDetails) { server.ID = "server-2" }},
		{name: "host", mutate: func(server *types.ServerDetails) { server.Host = "other.example.com" }},
		{name: "port", mutate: func(server *types.ServerDetails) { server.Port = 2222 }},
		{name: "username", mutate: func(server *types.ServerDetails) { server.Username = "other-user" }},
		{name: "password", mutate: func(server *types.ServerDetails) { server.Password = "attacker-password" }},
		{name: "private key", mutate: func(server *types.ServerDetails) { server.PrivateKey = "attacker-private-key" }},
		{name: "passphrase", mutate: func(server *types.ServerDetails) { server.Passphrase = "attacker-passphrase" }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := cloneServerDetails(base)
			test.mutate(changed)
			assert.NotEqual(t, baseIdentity, pool.connectionIdentity(changed))
		})
	}

	assert.Equal(t, baseIdentity, pool.connectionIdentity(cloneServerDetails(base)))
	assert.Len(t, baseIdentity, len("ssh:")+sha256.Size*2)
	for _, secretOrIdentifier := range []string{
		base.ID,
		base.Host,
		base.Username,
		base.Password,
		base.PrivateKey,
		base.Passphrase,
	} {
		assert.NotContains(t, baseIdentity, secretOrIdentifier)
	}
}

func TestPoolDoesNotReuseConnectionAcrossUsersAtSameEndpoint(t *testing.T) {
	pool := identityTestPool()
	victim := &types.ServerDetails{
		ID:       "victim-server",
		Host:     "shared.example.com",
		Port:     22,
		Username: "victim",
		Password: "victim-password",
	}
	attacker := cloneServerDetails(victim)
	attacker.Username = "attacker"

	victimIdentity := pool.connectionIdentity(victim)
	attackerIdentity := pool.connectionIdentity(attacker)
	require.NotEqual(t, victimIdentity, attackerIdentity)

	victimConnection := &ssh.Client{}
	pool.addConnection(victimIdentity, victimConnection)
	pool.Put(victimIdentity, victimConnection, true)

	assert.Nil(t, pool.getExistingConnection(attackerIdentity))
	assert.Same(t, victimConnection, pool.getExistingConnection(victimIdentity))
}

func TestPoolDoesNotReuseConnectionAfterCredentialRotation(t *testing.T) {
	pool := identityTestPool()
	beforeRotation := &types.ServerDetails{
		ID:       "server-1",
		Host:     "shared.example.com",
		Port:     22,
		Username: "deploy",
		Password: "old-password",
	}
	afterRotation := cloneServerDetails(beforeRotation)
	afterRotation.Password = "new-password"

	oldIdentity := pool.connectionIdentity(beforeRotation)
	newIdentity := pool.connectionIdentity(afterRotation)
	require.NotEqual(t, oldIdentity, newIdentity)

	oldConnection := &ssh.Client{}
	pool.addConnection(oldIdentity, oldConnection)
	pool.Put(oldIdentity, oldConnection, true)

	assert.Nil(t, pool.getExistingConnection(newIdentity))
	assert.Same(t, oldConnection, pool.getExistingConnection(oldIdentity))
}
