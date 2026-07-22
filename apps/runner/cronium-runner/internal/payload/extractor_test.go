package payload

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

// buildArchive writes a tar.gz containing the given members.
type member struct {
	name     string
	body     string
	typeflag byte
	size     int64 // override for a lying header
}

func buildArchive(t *testing.T, members []member) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, m := range members {
		size := int64(len(m.body))
		if m.size != 0 {
			size = m.size
		}
		tf := m.typeflag
		if tf == 0 {
			tf = tar.TypeReg
		}
		hdr := &tar.Header{Name: m.name, Mode: 0o644, Size: size, Typeflag: tf}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if tf == tar.TypeReg {
			if _, err := tw.Write([]byte(m.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "payload.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractHappyPath(t *testing.T) {
	path := buildArchive(t, []member{
		{name: "manifest.yaml", body: "x: 1"},
		{name: "script.sh", body: "echo hi"},
	})
	dir, err := Extract(path)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	defer os.RemoveAll(dir)
	if _, err := os.Stat(filepath.Join(dir, "script.sh")); err != nil {
		t.Fatalf("expected script.sh extracted: %v", err)
	}
}

func TestExtractRejectsParentTraversal(t *testing.T) {
	path := buildArchive(t, []member{{name: "../evil.sh", body: "pwn"}})
	if _, err := Extract(path); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestExtractRejectsAbsolutePath(t *testing.T) {
	path := buildArchive(t, []member{{name: "/etc/evil", body: "pwn"}})
	if _, err := Extract(path); err == nil {
		t.Fatal("expected absolute-path rejection")
	}
}

func TestExtractRejectsMemberCount(t *testing.T) {
	members := make([]member, maxMembers+1)
	for i := range members {
		members[i] = member{name: filepathSafe(i), body: "x"}
	}
	path := buildArchive(t, members)
	if _, err := Extract(path); err == nil {
		t.Fatal("expected member-count rejection")
	}
}

func TestExtractRejectsOversizedHeader(t *testing.T) {
	// Forge a tar header that declares a size over the per-file ceiling with no
	// body, so the ceiling check rejects it before any copy. archive/tar's
	// Writer won't let us under-write a body, so emit the raw 512-byte header.
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	hdr := make([]byte, 512)
	copy(hdr[0:], "big.bin")
	copy(hdr[100:], []byte("0000644\x00")) // mode
	// size field (offset 124, 12 bytes, octal) = a value over the ceiling
	copy(hdr[124:], []byte("77777777777\x00")) // ~8 GiB in octal
	hdr[156] = tar.TypeReg
	copy(hdr[257:], []byte("ustar\x0000")) // magic+version
	// checksum (offset 148, 8 bytes): spaces then computed sum
	for i := 148; i < 156; i++ {
		hdr[i] = ' '
	}
	var sum int
	for _, b := range hdr {
		sum += int(b)
	}
	copy(hdr[148:], []byte(itoaOctal(sum)+"\x00 "))
	gz.Write(hdr)
	gz.Close()

	path := filepath.Join(t.TempDir(), "forged.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Extract(path); err == nil {
		t.Fatal("expected oversize-header rejection")
	}
}

func itoaOctal(n int) string {
	if n == 0 {
		return "000000"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%8)}, b...)
		n /= 8
	}
	for len(b) < 6 {
		b = append([]byte{'0'}, b...)
	}
	return string(b)
}

func TestExtractSkipsSymlinks(t *testing.T) {
	path := buildArchive(t, []member{
		{name: "link", body: "/etc/passwd", typeflag: tar.TypeSymlink},
		{name: "ok.sh", body: "echo"},
	})
	dir, err := Extract(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer os.RemoveAll(dir)
	if _, err := os.Lstat(filepath.Join(dir, "link")); !os.IsNotExist(err) {
		t.Fatal("symlink should not have been extracted")
	}
}

func TestResolveEntrypointContainment(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "script.sh"), []byte("echo"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := ResolveEntrypoint(dir, "script.sh"); err != nil {
		t.Fatalf("expected valid entrypoint, got %v", err)
	}
	if _, err := ResolveEntrypoint(dir, "../escape.sh"); err == nil {
		t.Fatal("expected parent-traversal entrypoint rejection")
	}
	if _, err := ResolveEntrypoint(dir, "/etc/passwd"); err == nil {
		t.Fatal("expected absolute entrypoint rejection")
	}
	if _, err := ResolveEntrypoint(dir, "missing.sh"); err == nil {
		t.Fatal("expected missing-file rejection")
	}
}

func TestIsWithinNoSiblingPrefixBug(t *testing.T) {
	// The old strings.HasPrefix check treated /x/AAABBB as inside /x/AAA.
	if isWithin("/x/AAA", "/x/AAABBB/evil") {
		t.Fatal("sibling-prefix path must NOT be considered contained")
	}
	if !isWithin("/x/AAA", "/x/AAA/ok") {
		t.Fatal("real child must be contained")
	}
}

func filepathSafe(i int) string {
	return "f" + itoa(i) + ".txt"
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
