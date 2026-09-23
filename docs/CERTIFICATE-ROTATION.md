# Certificate rotation

This document tells you what to do when SSL.com changes the certificate chain of its servers.

## The symptom

The action fails and the log shows this text:

```
javax.net.ssl.SSLHandshakeException: PKIX path building failed:
sun.security.provider.certpath.SunCertPathBuilderException:
unable to find valid certification path to requested target
	at com.ssl.code.signing.tool.csc.CscApi.getCredentialIDs(CscApi.java:37)
```

## The cause

`CodeSignTool.zip` contains its own Java runtime. The truststore of that runtime is a frozen
file. It is `jdk-*/lib/security/cacerts` inside the zip. The runner cannot update it. The
Windows certificate store does not apply to it.

When SSL.com moves a host to a root that this frozen truststore does not hold, every signing
run fails.

`login.ssl.com` and `oauth-sandbox.ssl.com` can use a different root from `cs.ssl.com` and
`cs-try.ssl.com`. So the failure can start at the first call to the CSC API, after the OAuth
call succeeds.

## Step 1. Find the new root

```bash
for h in cs.ssl.com login.ssl.com cs-try.ssl.com oauth-sandbox.ssl.com; do
  echo "===== $h ====="
  rm -f /tmp/ch_*.pem
  openssl s_client -connect $h:443 -servername $h -showcerts </dev/null 2>/dev/null \
    | awk '/-----BEGIN CERTIFICATE-----/{n++} n{print > ("/tmp/ch_" n ".pem")}'
  for f in /tmp/ch_*.pem; do
    openssl x509 -in "$f" -noout -subject -fingerprint -sha256 | tr '\n' ' '; echo
  done
done
```

The last certificate of each chain is the root. Compare its fingerprint with the value in
`TRUSTED_ROOTS` in [truststore.js](../truststore.js). A new fingerprint means you must add the root.

## Step 2. Get a trusted copy of the root

Do not use the copy that the server sent you. Export the root from an operating system root
store, then compare the two fingerprints.

On macOS:

```bash
security find-certificate -a -c "<the common name of the root>" -p \
  /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/new-root.pem

openssl x509 -in /tmp/new-root.pem -noout -subject -issuer -dates -fingerprint -sha256
```

The fingerprint must be the same as the one that the server sent. If it is not the same, stop.
Do not continue.

> **Warning.** Never collect the chain at run time with `rejectUnauthorized: false`. That turns
> off certificate checks on the same request that carries the signing user name, the password
> and the TOTP secret. An attacker between you and SSL.com could then read them. Always put the
> certificate in the repository, and always review it.

## Step 3. Add the certificate to the repository

Put the file in `certs/`. Keep the file clean. Do not put comment text before the
`-----BEGIN CERTIFICATE-----` line, because the Java certificate reader is not reliable with it.

Then add an entry to `TRUSTED_ROOTS` in [truststore.js](../truststore.js):

```js
{
    alias: "acre-<short name>",
    file: "<file name>.pem",
    subject: "<subject from openssl>",
    notAfter: "<expiry in ISO format>",
    sha256: "<fingerprint with no colons, in capitals>",
},
```

Use an alias that starts with `acre-`. This keeps it separate from any alias that SSL.com uses.

You need only the root. The servers send their own intermediate certificates.

## Step 4. Run the tests

```bash
npm test
```

The tests check these things:

- The fingerprint of the file is the same as the pinned value.
- The subject is the same as the recorded subject.
- The certificate is a self-signed root, and its own signature is correct.
- The certificate has not expired, and the expiry is the same as the recorded expiry.
- A change of one byte in the file makes the tests fail.

If you change the certificate but not the pinned fingerprint, the tests fail. This is on purpose.

## Step 5. Build `dist/`

```bash
NODE_OPTIONS=--openssl-legacy-provider npm run prepare
```

The flag is necessary on Node 17 and later. `ncc` 0.31 uses webpack 4, which hashes with MD4,
and OpenSSL 3 removed MD4. Without the flag the build stops with `ERR_OSSL_EVP_UNSUPPORTED`.

`ncc` copies `certs/` to `dist/certs/`. Add that folder to git.

The file `dist/index.js` is the file that runs. A change to `index.js` has no effect until you
build. The `Check dist/` workflow fails if you forget.

## Step 6. Test in CI

Open a pull request. Two jobs must be green:

| Job | What it proves |
|---|---|
| `Unit tests` | The certificate is correct and the helpers work |
| `Sandbox sign test` | The action signs a file through `cs-try.ssl.com` |
| `Check dist/` | `dist/` is built from the current source |

The sandbox job is the important one. `cs-try.ssl.com` used the same root as `cs.ssl.com` in
September 2026. Check this with the command in Step 1 before you trust the result.

If the sandbox job fails, read the `Diagnose the failure` step. It prints the log files of
CodeSignTool, the truststore contents and a direct run of the tool.

## Step 7. Release

1. Write down the current commit of the `latest` tag: `git rev-parse latest`. Keep this value.
2. Merge the pull request.
3. Move the `latest` tag.

> **Warning.** `latest` is a moving reference. Production release pipelines use it, and those
> steps receive the production signing secrets. Get agreement from the team before you move it.

4. Run the release workflow of the consumer repository again.
5. Check the file itself, not only the green mark:

```
signtool verify /pa /v <the signed file>.exe
```

## Rollback

Move the `latest` tag back to the commit that you wrote down in Step 7.

## How the import works

The action does not trust the exit code of `keytool`. `keytool` refuses to import a certificate
that is already in the store, and it then exits with an error. The text of that message has
changed between Java releases.

So the action does this:

1. Run `keytool -list`. If the fingerprint is there, do nothing.
2. If it is not there, import it.
3. Run `keytool -list` again. Fail only if the fingerprint is still missing.

Two results follow from this. The step is safe to run again. And if SSL.com adds the root to
their own zip, step 1 finds it and the action does nothing. You do not need to remove anything
from this repository when that happens.

If the action finds no bundled Java runtime, it writes a warning and continues. It does not stop
the release. A later Java runtime may already trust the root.
