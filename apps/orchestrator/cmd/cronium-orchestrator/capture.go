package main

import "fmt"

// Per-stream in-memory output cap (head + tail halves). A log-heavy job can no
// longer OOM the orchestrator or POST an unbounded completion blob; what was
// omitted is counted and reported (PLAN.md §5).
const outputStreamCapBytes = 1024 * 1024

// cappedCapture keeps the first and last half of a byte budget and counts
// what was omitted between them (PLAN.md §5 bounded output).
type cappedCapture struct {
	head    []byte
	tail    []byte
	total   int64
	halfCap int
}

func newCappedCapture(capBytes int) *cappedCapture {
	return &cappedCapture{halfCap: capBytes / 2}
}

func (c *cappedCapture) WriteLine(line string) {
	b := append([]byte(line), '\n')
	c.total += int64(len(b))
	if len(c.head) < c.halfCap {
		room := c.halfCap - len(c.head)
		if len(b) <= room {
			c.head = append(c.head, b...)
			return
		}
		c.head = append(c.head, b[:room]...)
		b = b[room:]
	}
	c.tail = append(c.tail, b...)
	if over := len(c.tail) - c.halfCap; over > 0 {
		c.tail = c.tail[over:]
	}
}

func (c *cappedCapture) OmittedBytes() int64 {
	omitted := c.total - int64(len(c.head)) - int64(len(c.tail))
	if omitted < 0 {
		return 0
	}
	return omitted
}

func (c *cappedCapture) String() string {
	if c.OmittedBytes() == 0 {
		return string(c.head) + string(c.tail)
	}
	return fmt.Sprintf("%s\n... [output truncated: %d bytes omitted] ...\n%s",
		string(c.head), c.OmittedBytes(), string(c.tail))
}
