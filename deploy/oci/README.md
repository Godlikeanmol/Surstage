# Zero-Cost Self-Hosted Production Deployment (Oracle Cloud Always Free + Vercel)

## 1. Provision Oracle Cloud Always Free ARM64 (`ap-mumbai-1`)
- Allocate **2 OCPU / 12 GB RAM** (`VM.Standard.A1.Flex`, Ubuntu 24.04 ARM64) — do not exceed 2 OCPU / 12 GB.
- Run `./provision-oci-arm.sh` (loops every 60s through `Out of host capacity` errors).

## 2. Open Required Firewall Ports (Both OCI Security List & Ubuntu `iptables`)
- `80/TCP` (HTTP ACME challenge)
- `443/TCP` (HTTPS + WebSockets + LiveKit TLS TURN)
- `7881/TCP` (LiveKit RTC over TCP fallback)
- `3478/UDP` (STUN / TURN UDP)
- `50000-60000/UDP` (WebRTC RTP media range)

## 3. Launch Docker Compose Stack
```bash
export DOMAIN=karaoke.yourdomain.com
export LIVEKIT_API_KEY=yourkey
export LIVEKIT_API_SECRET=$(openssl rand -hex 24)
docker compose up -d
```
