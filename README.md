# ssl-sign-file-windows

Sign a file using SSL.com's CodeSignTool for Windows. Use this to sign a file with an action running on a windows image.

| Environment | Action To Use                                       |
|-------------|-----------------------------------------------------|
| Linux       | https://github.com/feenicsinc/ssl-sign-file         |
| Windows     | https://github.com/feenicsinc/ssl-sign-file-windows | 

## Inputs

### `filepath`

**Required** File to be signed.

### `sslusername`

**Required** SSL.com account username.

### `sslpassword`

**Required** SSL.com account password.

### `sslsecretpassword`

**Required** SSL.com account TOTP secret.

### `istest`

When `false`, runs against SSL.com Production account.  Default `true`.

## Outputs

## none

## Example usage

        - id: Sign_Feenics_Keep_Windows_exe
          uses: feenicsinc/ssl-sign-file-windows@latest
          with:
            filepath: "${{ github.workspace }}\\Feenics.Keep.Windows\\Feenics.Keep.Windows\\bin\\x86\\DEV\\Feenics.Keep.Windows.exe"
            sslusername: ${{ secrets.SSL_USRNM }}
            sslpassword: ${{ secrets.SSL_PWD }}
            sslsecretpassword: ${{ secrets.SSL_TKN }}
            sslclientid: ${{ secrets.SSL_CLIENT_ID }}
            istest: false

## Trusted certificates

`CodeSignTool.zip` contains its own Java runtime with a frozen truststore. That truststore
cannot receive updates from the runner or from Windows. When SSL.com moves a server to a new
root, every signing run fails with a `PKIX path building failed` error.

The `certs/` folder holds the roots that the bundled runtime does not carry. The action adds
them to the truststore before it signs. The fingerprint of each certificate is pinned in
`truststore.js`, so a changed file fails the tests.

Read [docs/CERTIFICATE-ROTATION.md](docs/CERTIFICATE-ROTATION.md) before you add or change a
certificate.

## Development

Use Node 24. This is the version that the action runs on.

Build the bundle that the action runs:

        npm run prepare

`npm ci` and `npm install` also run this build.

Run the tests:

        npm test

`action.yml` points at `dist/index.js`. A change to `index.js` has no effect until you build.
The `Check dist/` workflow fails if you forget to commit the result.
