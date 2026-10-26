# FaxingPro: Telnyx DID + VPS SIP/T.38 integration

**Status: integration preparation, NOT live fax service.** You already purchased a Telnyx DID. This guide assumes that a Linux VPS will host the fax engine. The public GitHub Pages site remains a static demo.

## Update: VPS diagnostics and safe Debian image staging (October 26, 2026)

Your VPS is **Ubuntu 26.04 x86_64**, with **2 CPU cores, 7.3 GiB RAM and an existing Docker installation**. It has sufficient resources for a controlled, low-concurrency fax pilot. Its native configured apt repositories have no FreeSWITCH package, and its MooBee Caddy already owns public ports 80/443.

Use the [staged Debian 12 FreeSWITCH image build](../deployment/freeswitch/README.md) first. It requires a **SignalWire PAT** (separate from Telnyx) and **only builds a container image**. This does not open SIP ports, start the PBX, change your firewall, or route your existing DID.

**Do not route the Telnyx DID or open SIP to the public internet yet.** Once the image build succeeds, configure and harden Sofia, ESL and dialplans before starting the first call.

## 1. Run the safe read-only preflight

On the actual intended VPS:

~~~bash
git clone https://github.com/migtam628/FaxingPro.git
cd FaxingPro
bash scripts/vps-preflight.sh
~~~

Review the OS version, architecture, RAM, disk, public IPv4, SIP listeners and FreeSWITCH status. **Do not share credentials, .env files or account tokens.** This script makes no system changes.

## 2. Configure Telnyx Mission Control

Go to https://portal.telnyx.com/ and configure:

1. **Voice → SIP Trunking → SIP Connections**: create or use a SIP connection named FaxingPro-VPS. Choose **IP Address authentication** if the VPS has a **static public IPv4**. Enter the actual public IP and the actual FreeSWITCH listening port, which may be 5080 on an external profile rather than 5060. Otherwise plan credential or FQDN authentication.
2. **Voice → Outbound Voice Profiles**: create FaxingPro-Test, associate the connection, allow **US only**, limit outbound channels to **1**, and set a modest daily spend cap.
3. **Numbers → My Numbers**: assign the **already purchased DID** to the FaxingPro SIP connection. Confirm its incoming destination format for DID-specific dialplan matching.
4. **Outbound fax setting**: set **T.38 Re-invite Initiated By: Telnyx** to start; FreeSWITCH should initially accept Telnyx-initiated T.38 when sending.
5. **Inbound fax**: inspect the DID Expert Config T.38FAX Gateway setting. Telnyx generally expects the **customer** to initiate the inbound T.38 re-INVITE. FreeSWITCH can request one; if the far end does not negotiate T.38, G.711 may still work.

This requires a **Telnyx SIP connection**, not a Telnyx hosted Programmable Fax Application.

## 3. Install the fax engine, after confirming your distribution

FreeSWITCH with **mod_sofia** and **mod_spandsp** is needed for SIP and the rxfax/txfax applications. Telnyx credentials alone do not install a fax engine. Official FreeSWITCH packages may require a **SignalWire Personal Access Token**; the supported alternative is an official source build. Do not run arbitrary install scripts.

Official installation: https://developer.signalwire.com/freeswitch/foundations/getting-started/

After installation:

~~~bash
sudo systemctl status freeswitch --no-pager
fs_cli -x 'status'
fs_cli -x 'sofia status'
fs_cli -x 'show modules' | grep -i mod_spandsp
sudo ss -lunp | grep -E ':(5060|5080)[[:space:]]'
~~~

A working external Sofia profile and a loaded mod_spandsp module must be confirmed before any real call test. Disable insecure bundled demo PBX accounts.

## 4. Networking and security

- Telnyx US outbound SIP hostname: **sip.telnyx.com**; Telnyx UDP/TCP SIP signaling uses **5060**, TLS **5061**, while your local listening port may differ.
- Check both **FreeSWITCH's configured UDP media range** and Telnyx's published media source ranges. Telnyx's RTP range does NOT automatically describe your VPS's listening range.
- Allow only published **Telnyx signaling and media IPs** for the chosen region and media anchor. Consult the live provider list at https://sip.telnyx.com/ or https://sip.telnyx.com/voice.json.
- Account for T.38 negotiated **UDPTL** media as well as voice RTP. Do not assume voice RTP firewall rules suffice.
- Configure FreeSWITCH to advertise its actual public IPv4 in SIP/SDP; private SDP addressing can produce Telnyx SIP 488 errors.
- **Never publicly expose 8021/TCP (FreeSWITCH Event Socket), PostgreSQL or Redis.** Secure SSH access and VPS rescue-console availability *before* changing any firewall rules.
- Use conservative spend, destination-country and rate limits to prevent toll fraud.

## 5. Test gates before integrating ATLAS

**A. SIP call reaches VPS:** place a call to the DID and confirm the INVITE lands on the intended Sofia external profile using Telnyx SIP debugging and FreeSWITCH logs.

**B. Receive one real fax:** with a DID-specific inbound rule, use FreeSWITCH **rxfax**, a unique TIFF output path per call, disable echo cancellation, configure T.38 request/accept behavior, and confirm fax result, transferred pages and stored TIFF.

**C. Send one real fax:** prepare a non-sensitive, single-page PDF and convert to fax-compatible TIFF. Manually originate exactly one authorized test call through the outbound Telnyx trunk; execute **txfax only after answer**. Inspect the protocol result, actual pages, remote station ID and carrier call record.

**D. Production app integration:** implement PostgreSQL/document storage/authentication, private FreeSWITCH event integration, job queue, validated uploads, PDF↔TIFF conversion, retries and real result reconciliation. Only then connect the Send button and replace synthetic ATLAS records.

A connected SIP call is not a confirmed fax delivery. The starter API intentionally rejects POST fax submissions with HTTP 503 until a real transport and storage layer exist.

## 6. What to report next (no secrets)

Provide the **read-only preflight output** and these four nonsecret details:

- Is the VPS public IPv4 **static**?
- Telnyx SIP authentication planned: **IP Address**, **Credentials**, or **FQDN**?
- Is the DID assigned to the connection? Its last four digits are enough.
- Is FreeSWITCH already installed on the VPS?

Do not send full API keys, connection passwords, private keys or server .env files.

## Verified references

- Telnyx SIP details and current IP ranges: https://sip.telnyx.com/
- Telnyx connection types: https://support.telnyx.com/en/articles/4245868-sip-connection-types
- Telnyx DID assignment: https://support.telnyx.com/en/articles/1177115-how-to-setup-a-did-to-sip-connection
- Telnyx T.38 outbound configuration: https://support.telnyx.com/en/articles/4404448-sip-connection-inbound-outbound-settings
- FreeSWITCH fax apps and negotiation: https://developer.signalwire.com/freeswitch/applications/fax/
- FreeSWITCH installation: https://developer.signalwire.com/freeswitch/foundations/getting-started/

## Dedicated loopback HTTP port for this VPS

Your MooBee Nginx stack uses `127.0.0.1:8080`. FaxingPro's Compose configuration now uses a configurable host port `FAXINGPRO_HTTP_PORT`, with the example environment set to **8092**. This leaves MooBee untouched. Do not launch a second Caddy or Nginx on the public ports 80/443; MooBee's Caddy is already bound there. Before exposing the FaxingPro API remotely, implement authentication and a separate hostname behind a carefully controlled reverse proxy.
