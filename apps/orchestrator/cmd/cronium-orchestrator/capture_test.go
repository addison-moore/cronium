package main

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCappedCaptureUnderCapKeepsEverything(t *testing.T) {
	t.Parallel()
	c := newCappedCapture(64)
	c.WriteLine("hello")
	c.WriteLine("world")
	require.Equal(t, "hello\nworld\n", c.String())
	require.Equal(t, int64(0), c.OmittedBytes())
}

func TestCappedCaptureExactCapBoundaryOmitsNothing(t *testing.T) {
	t.Parallel()
	// cap 16 -> halfCap 8; two 8-byte lines fill head and tail exactly.
	c := newCappedCapture(16)
	c.WriteLine("1234567") // 8 bytes with newline -> head
	c.WriteLine("abcdefg") // 8 bytes with newline -> tail
	require.Equal(t, int64(0), c.OmittedBytes())
	require.Equal(t, "1234567\nabcdefg\n", c.String())
}

func TestCappedCaptureOneByteOverCapOmitsOneByte(t *testing.T) {
	t.Parallel()
	// cap 16 -> halfCap 8. 17 bytes total: head keeps the first 8, the tail
	// window slides to the last 8, exactly 1 byte falls out in the middle.
	c := newCappedCapture(16)
	c.WriteLine("1234567")  // 8 bytes -> head full
	c.WriteLine("abcdefgh") // 9 bytes -> tail keeps last 8
	require.Equal(t, int64(1), c.OmittedBytes())
	require.Equal(t, "1234567\n\n... [output truncated: 1 bytes omitted] ...\nbcdefgh\n", c.String())
}

func TestCappedCaptureOverCapKeepsHeadAndTailHalves(t *testing.T) {
	t.Parallel()
	c := newCappedCapture(16)
	c.WriteLine("1234567") // head
	c.WriteLine("mmmmmmm") // middle, evicted
	c.WriteLine("abcdefg") // tail
	require.Equal(t, int64(8), c.OmittedBytes())
	require.Equal(t, "1234567\n\n... [output truncated: 8 bytes omitted] ...\nabcdefg\n", c.String())
}

func TestCappedCaptureSingleLineLargerThanCap(t *testing.T) {
	t.Parallel()
	c := newCappedCapture(8)        // halfCap 4
	c.WriteLine("abcdefghijklmnop") // 17 bytes with newline
	require.Equal(t, int64(17-4-4), c.OmittedBytes())
	require.Equal(t, "abcd\n... [output truncated: 9 bytes omitted] ...\nnop\n", c.String())
}

func TestCappedCaptureOddCapUsesFlooredHalves(t *testing.T) {
	t.Parallel()
	c := newCappedCapture(7)  // halfCap 3
	c.WriteLine("abcdefghij") // 11 bytes
	require.Equal(t, int64(11-3-3), c.OmittedBytes())
	require.True(t, strings.HasPrefix(c.String(), "abc\n"))
	require.True(t, strings.HasSuffix(c.String(), "ij\n"))
}

func TestCappedCaptureEmpty(t *testing.T) {
	t.Parallel()
	c := newCappedCapture(16)
	require.Equal(t, "", c.String())
	require.Equal(t, int64(0), c.OmittedBytes())
}
