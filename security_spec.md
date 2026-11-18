# SurStage Firestore Security Specification

## 1. Data Invariants
1. **Identity Integrity**: Every document write requires `request.auth != null` and `request.auth.token.email_verified == true`. Creator/owner UID fields (`uid`, `addedByUid`, `hostUid`, `requestedByUid`) must equal `request.auth.uid` on create and remain immutable on non-admin updates (except explicit admin transfer of `hostUid` by current `hostUid`).
2. **PII Isolation**: User emails live exclusively in `/users/{userId}/private/info`, readable and writable only by `request.auth.uid == userId` or verified admin.
3. **Catalog Integrity**: `/songs/{songId}` enforces strict YouTube 11-char `videoId` pattern (`^[a-zA-Z0-9_\-]{11}$`), allowed categories enum, string length bounds, and server timestamps (`request.time`).
4. **Master Gate**: `/rooms/{roomCode}/savedQueue/{itemId}` reads parent `/rooms/{roomCode}` via `get()` and requires the room to exist and be open (`isOpen == true`) or owned by the caller.
5. **Query Enforcer**: `allow list` rules evaluate `resource.data` directly without `get()`/`exists()` calls (`resource.data.isPublic == true` on `/songs`, `resource.data.hostUid == request.auth.uid` on `/rooms`).

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Song Create**: Unauthenticated user writes to `/songs/track_1` -> Denied by `isVerifiedUser()`.
2. **Unverified Email Spoof**: User with `email: "anmol002425@gmail.com"` and `email_verified: false` attempts admin write -> Denied by `email_verified == true`.
3. **Ghost Field Shadow Update**: Authenticated owner updates `/songs/track_1` with `{ title: "New", isVerified: true }` -> Denied by `affectedKeys().hasOnly(...)` and `isValidSong()`.
4. **UID Spoofing on Create**: User `u1` creates `/rooms/ABCDEF` with `hostUid: "u2"` -> Denied by `incoming().hostUid == request.auth.uid`.
5. **Path ID Poisoning**: User creates `/songs/` with 500-char ID or invalid characters `bad/id$1` -> Denied by `isValidId(songId)`.
6. **Category Enum Injection**: User creates `/songs/s1` with `category: "Metal"` -> Denied by category allowlist check.
7. **Invalid VideoId Injection**: User creates `/songs/s1` with `videoId: "javascript:alert(1)"` -> Denied by 11-char regex check.
8. **Backdated Timestamp Spoof**: User creates `/songs/s1` with `createdAt` 10 days in the past -> Denied by `incoming().createdAt == request.time`.
9. **Immutable Creator Tamper**: Non-admin user updates `/songs/s1` changing `addedByUid` -> Denied by `incoming().addedByUid == existing().addedByUid`.
10. **Cross-User PII Read**: User `u1` reads `/users/u2/private/info` -> Denied by `isOwner(userId)`.
11. **Blanket Rooms List Scrape**: Non-admin user runs unrestricted collection query on `/rooms` containing another host's closed room -> Denied by `resource.data.hostUid == request.auth.uid`.
12. **Orphan Queue Item Injection**: User writes to `/rooms/NO_SUCH_ROOM/savedQueue/q1` -> Denied by Master Gate `get(...)` parent existence check.
