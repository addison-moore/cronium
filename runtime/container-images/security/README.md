# Container Security Best Practices

This directory contains security profiles and configurations for Cronium runtime containers.

## Seccomp Profiles

### Default Profile (`seccomp-default.json`)

- Allows common system calls needed for general script execution
- Blocks dangerous system calls like `ptrace`, `mount`, `setns`
- Suitable for development and testing

### Strict Profile (`seccomp-strict.json`)

- Minimal set of system calls for production use
- Only allows essential operations for script execution and HTTP requests
- Recommended for production deployments

## Usage

### Docker Run

```bash
docker run --security-opt seccomp=./security/seccomp-default.json cronium/python:latest
```

### Docker Compose

```yaml
services:
  script-runner:
    image: cronium/python:latest
    security_opt:
      - seccomp:./security/seccomp-default.json
    cap_drop:
      - ALL
    read_only: true
    tmpfs:
      - /tmp
      - /app
```

### Kubernetes

```yaml
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: Localhost
      localhostProfile: seccomp-default.json
  containers:
    - name: script-runner
      image: cronium/python:latest
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
        readOnlyRootFilesystem: true
```

## Additional Security Measures

### 1. Run as Non-Root

All Cronium containers run as user `cronium` (UID 1000) by default.

### 2. Read-Only Root Filesystem

Containers support read-only root filesystem with writable `/tmp` and `/app` mounted as tmpfs.

### 3. No Package Managers

Production images have package managers removed to prevent runtime package installation.

### 4. Minimal Attack Surface

- No shells in production images (except Bash image)
- Removed setuid/setgid binaries
- Minimal installed packages
- No development tools

### 5. Network Isolation

Configure containers with:

- No external network access (except for Runtime API)
- Internal DNS only
- Firewall rules to restrict connections

### 6. Resource Limits

Always set resource limits:

```yaml
resources:
  limits:
    cpu: "1"
    memory: "512Mi"
  requests:
    cpu: "100m"
    memory: "128Mi"
```

## Vulnerability Scanning

Scan images regularly:

```bash
# Using Trivy
trivy image cronium/python:latest

# Using Docker Scout
docker scout cves cronium/python:latest
```

## Compliance

These security measures help meet:

- CIS Docker Benchmark
- NIST container security guidelines
- PCI DSS requirements (when applicable)
- SOC 2 security controls
