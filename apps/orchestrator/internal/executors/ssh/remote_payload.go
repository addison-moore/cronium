package ssh

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"

	"golang.org/x/crypto/ssh"
)

const remotePayloadRandomBytes = 16

var remotePayloadDirectoryPattern = regexp.MustCompile(`^\.cronium-payload-[0-9a-f]{32}$`)

type remotePayloadLocation struct {
	Directory     string
	PayloadPath   string
	SignaturePath string
}

func newRemotePayloadLocation() (remotePayloadLocation, error) {
	randomBytes := make([]byte, remotePayloadRandomBytes)
	if _, err := rand.Read(randomBytes); err != nil {
		return remotePayloadLocation{}, fmt.Errorf("generate remote payload directory: %w", err)
	}

	directory := path.Join("/tmp", ".cronium-payload-"+hex.EncodeToString(randomBytes))
	return remotePayloadLocation{
		Directory:     directory,
		PayloadPath:   path.Join(directory, "payload.tar.gz"),
		SignaturePath: path.Join(directory, "payload.tar.gz.sig"),
	}, nil
}

func validateRemotePayloadDirectory(directory string) error {
	if path.Clean(directory) != directory || path.Dir(directory) != "/tmp" || !remotePayloadDirectoryPattern.MatchString(path.Base(directory)) {
		return fmt.Errorf("invalid remote payload directory")
	}
	return nil
}

func buildCreateRemotePayloadDirectoryCommand(directory string) string {
	quotedDirectory := shellQuote(directory)
	return fmt.Sprintf(
		"umask 077 && command -p mkdir %s && command -p chmod 0700 %s && test -d %s && test ! -L %s",
		quotedDirectory,
		quotedDirectory,
		quotedDirectory,
		quotedDirectory,
	)
}

func createRemotePayloadDirectory(conn *ssh.Client) (remotePayloadLocation, error) {
	location, err := newRemotePayloadLocation()
	if err != nil {
		return remotePayloadLocation{}, err
	}
	if err := validateRemotePayloadDirectory(location.Directory); err != nil {
		return remotePayloadLocation{}, err
	}
	if err := runRemoteCommand(conn, buildCreateRemotePayloadDirectoryCommand(location.Directory)); err != nil {
		// Do not recursively remove on creation failure: an adversarial same-UID
		// process could have won the exclusive mkdir race at this random name.
		return remotePayloadLocation{}, fmt.Errorf("create private remote payload directory: %w", err)
	}
	return location, nil
}

func buildCleanupRemotePayloadDirectoryCommand(directory string) (string, error) {
	if err := validateRemotePayloadDirectory(directory); err != nil {
		return "", err
	}
	quotedDirectory := shellQuote(directory)
	return fmt.Sprintf(
		"if [ ! -e %s ] && [ ! -L %s ]; then exit 0; fi; test -d %s && test ! -L %s && command -p rm -rf %s",
		quotedDirectory,
		quotedDirectory,
		quotedDirectory,
		quotedDirectory,
		quotedDirectory,
	), nil
}

func cleanupRemotePayloadDirectory(conn *ssh.Client, directory string) error {
	command, err := buildCleanupRemotePayloadDirectoryCommand(directory)
	if err != nil {
		return err
	}
	if err := runRemoteCommand(conn, command); err != nil {
		return fmt.Errorf("remove private remote payload directory: %w", err)
	}
	return nil
}

func randomPayloadUploadPath(finalPath string) (string, error) {
	randomBytes := make([]byte, remotePayloadRandomBytes)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate remote payload upload path: %w", err)
	}
	return finalPath + ".upload-" + hex.EncodeToString(randomBytes), nil
}

func buildExclusiveUploadCommand(remotePath string) string {
	return fmt.Sprintf("umask 077 && set -C && command -p cat > %s", shellQuote(remotePath))
}

func buildPublishPayloadFileCommand(uploadPath, finalPath string) string {
	quotedUpload := shellQuote(uploadPath)
	quotedFinal := shellQuote(finalPath)
	return fmt.Sprintf(
		"test -f %s && test ! -L %s && command -p chmod 0600 %s && test -f %s && test ! -L %s && command -p ln %s %s && command -p rm -f %s && test -f %s && test ! -L %s",
		quotedUpload,
		quotedUpload,
		quotedUpload,
		quotedUpload,
		quotedUpload,
		quotedUpload,
		quotedFinal,
		quotedUpload,
		quotedFinal,
		quotedFinal,
	)
}

func streamLocalFileExclusive(conn *ssh.Client, localPath, remotePath string) error {
	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local file: %w", err)
	}
	defer localFile.Close()

	copySession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("create file upload session: %w", err)
	}
	defer copySession.Close()

	stdin, err := copySession.StdinPipe()
	if err != nil {
		return fmt.Errorf("create file upload pipe: %w", err)
	}
	if err := copySession.Start(buildExclusiveUploadCommand(remotePath)); err != nil {
		return fmt.Errorf("start exclusive file upload: %w", err)
	}
	if _, err := io.Copy(stdin, localFile); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("stream file upload: %w", err)
	}
	if err := stdin.Close(); err != nil {
		return fmt.Errorf("close file upload: %w", err)
	}
	if err := copySession.Wait(); err != nil {
		return fmt.Errorf("finish exclusive file upload: %w", err)
	}
	return nil
}

func uploadPayloadFileAtomically(conn *ssh.Client, localPath, finalPath string) error {
	uploadPath, err := randomPayloadUploadPath(finalPath)
	if err != nil {
		return err
	}
	defer removeRemoteFile(conn, uploadPath)

	if err := streamLocalFileExclusive(conn, localPath, uploadPath); err != nil {
		return err
	}
	// A hard-link publish is atomic and fails if the final path already exists;
	// unlike mv, it cannot silently overwrite a concurrent upload.
	if err := runRemoteCommand(conn, buildPublishPayloadFileCommand(uploadPath, finalPath)); err != nil {
		return fmt.Errorf("publish remote payload file atomically: %w", err)
	}
	return nil
}

func uploadPayloadToServer(conn *ssh.Client, localPath string, location remotePayloadLocation) error {
	if err := validateRemotePayloadDirectory(location.Directory); err != nil {
		return err
	}
	if location.PayloadPath != path.Join(location.Directory, "payload.tar.gz") || location.SignaturePath != location.PayloadPath+".sig" {
		return fmt.Errorf("remote payload files escape their private directory")
	}

	if err := uploadPayloadFileAtomically(conn, localPath, location.PayloadPath); err != nil {
		return fmt.Errorf("upload payload: %w", err)
	}

	signaturePath := localPath + ".sig"
	if _, err := os.Stat(signaturePath); err == nil {
		if err := uploadPayloadFileAtomically(conn, signaturePath, location.SignaturePath); err != nil {
			return fmt.Errorf("upload payload signature: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect payload signature: %w", err)
	}

	return nil
}
