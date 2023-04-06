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
