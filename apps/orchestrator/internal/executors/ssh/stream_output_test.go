package ssh

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

func streamForTest(t *testing.T, output string) string {
	t.Helper()
	log := logrus.New()
	log.SetOutput(io.Discard)
	e := &Executor{log: log}

	// A pipe, like the SSH channel: a write finishes only when something reads it.
	reader, writer := io.Pipe()
	written := make(chan error, 1)
	go func() {
		_, err := io.WriteString(writer, output)
		_ = writer.Close()
		written <- err
	}()

	var (
		sequence   int64
		sequenceMu sync.Mutex
		buffer     strings.Builder
		bufferMu   sync.Mutex
	)
	updates := make(chan types.ExecutionUpdate, 16)
	done := make(chan struct{})
	go func() {
		e.streamOutputWithContextAndCollect(context.Background(), reader, "stdout", updates, &sequence, &sequenceMu, &buffer, &bufferMu)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("stopped reading before the script finished writing")
	}
	if err := <-written; err != nil {
		t.Fatalf("the script's write failed: %v", err)
	}
	return buffer.String()
}

// A long line arrives in pieces instead of ending the stream, the same as from a
// container, and a script can always finish writing. A scanner stopped reading here,
// which left the script blocked on its next write until the job timed out.
func TestStreamOutputSplitsALongLineAndKeepsGoing(t *testing.T) {
	long := strings.Repeat("x", maxLogLineBytes*2+10)
	got := streamForTest(t, "first\n"+long+"\nlast\n")

	lines := strings.Split(strings.TrimSuffix(got, "\n"), "\n")
	if len(lines) != 5 {
		t.Fatalf("got %d lines, want first, three pieces, and last", len(lines))
	}
	if lines[0] != "first" || lines[4] != "last" {
		t.Errorf("first = %q, last = %q", lines[0], lines[4])
	}
	if len(lines[1]) != maxLogLineBytes {
		t.Errorf("first piece is %d bytes, want %d", len(lines[1]), maxLogLineBytes)
	}
	if joined := strings.Join(lines[1:4], ""); joined != long {
		t.Errorf("the pieces join to %d bytes, want %d", len(joined), len(long))
	}
}

func TestStreamOutputKeepsBlankLinesAndAPartialLastLine(t *testing.T) {
	if got, want := streamForTest(t, "one\n\nthree\r\nno newline"), "one\n\nthree\nno newline\n"; got != want {
		t.Errorf("collected %q, want %q", got, want)
	}
}

func TestStreamOutputOfNothingCollectsNothing(t *testing.T) {
	if got := streamForTest(t, ""); got != "" {
		t.Errorf("collected %q, want nothing", got)
	}
}
