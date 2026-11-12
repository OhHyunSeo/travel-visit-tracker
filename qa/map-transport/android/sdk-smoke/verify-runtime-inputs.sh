#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 4 || ! "$2" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Usage: bash verify-runtime-inputs.sh <fixture.apk> <expected APK SHA-256> <fixture.p12> <Android build-tools directory>' >&2
  exit 2
fi

qa_apk="$1"
qa_tools="$4"
qa_actual=$(shasum -a 256 -- "$qa_apk" | cut -d ' ' -f 1)
if [[ "$qa_actual" != "$2" ]]; then
  echo 'Fixture APK SHA-256 differs from the recorded build.' >&2
  exit 1
fi

qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-runtime-inputs.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
"$qa_tools/apksigner" verify --min-sdk-version 36 "$qa_apk"
"$qa_tools/aapt2" dump badging "$qa_apk" >"$qa_temp/badging.txt"
if ! rg -q "^package: name='app\.trippainting\.maptransportqa\.sdk' " "$qa_temp/badging.txt" ||
    ! rg -Fqx "minSdkVersion:'36'" "$qa_temp/badging.txt" ||
    ! rg -Fqx "native-code: 'arm64-v8a'" "$qa_temp/badging.txt"; then
  echo 'Fixture APK package, Android API level or ABI differs from the smoke configuration.' >&2
  exit 1
fi

qa_port=$(unzip -p "$qa_apk" assets/fixture-port)
if [[ ! "$qa_port" =~ ^[1-9][0-9]{3,4}$ ]] || (( qa_port < 1024 || qa_port > 65535 )); then
  echo 'Fixture APK port is invalid.' >&2
  exit 1
fi
unzip -p "$qa_apk" assets/fixture.der >"$qa_temp/apk.der"
keytool -exportcert -alias fixture -keystore "$3" -storepass fixture-only-password >"$qa_temp/host.der"
if ! cmp -s "$qa_temp/apk.der" "$qa_temp/host.der"; then
  echo 'Fixture APK certificate differs from the host key store certificate.' >&2
  exit 1
fi
if ! keytool -certreq -alias fixture -keystore "$3" -storepass fixture-only-password -file "$qa_temp/identity.csr"; then
  echo 'Fixture host key store must contain the certificate and its private key.' >&2
  exit 1
fi
openssl req -in "$qa_temp/identity.csr" -verify -noout
openssl x509 -inform DER -in "$qa_temp/apk.der" -out "$qa_temp/fixture.pem"
openssl req -in "$qa_temp/identity.csr" -pubkey -noout >"$qa_temp/request.pub"
openssl x509 -in "$qa_temp/fixture.pem" -pubkey -noout | cmp - "$qa_temp/request.pub"
openssl verify -check_ss_sig -verify_ip 127.0.0.1 -CAfile "$qa_temp/fixture.pem" "$qa_temp/fixture.pem"
if ! openssl x509 -in "$qa_temp/fixture.pem" -noout -checkend 900; then
  echo 'Fixture certificate must stay valid for at least another 15 minutes.' >&2
  exit 1
fi

printf 'APK_SHA256=%s\nFIXTURE_PORT=%s\n' "$qa_actual" "$qa_port"
openssl x509 -in "$qa_temp/fixture.pem" -noout -enddate
