# Strapi 5 Presence Plugin

Plugin cho Strapi 5: **Real-time presence** (ai đang xem/sửa), **Action History** (audit log), **Version Snapshot & Restore** (khôi phục phiên bản cũ).

---

## Mục lục

1. [Tính năng](#tính-năng)
2. [Cài đặt](#cài-đặt)
3. [Cấu hình](#cấu-hình)
4. [Cấu trúc plugin](#cấu-trúc-plugin)
5. [API Endpoints](#api-endpoints)
6. [Version Snapshot & Restore](#version-snapshot--restore)
7. [Phát triển](#phát-triển)

---

## Tính năng

### Real-time Presence
- Avatars user đang xem/sửa entry trong Content Manager
- Typing indicators
- Socket.io, deduplication nhiều tab

### Action History
- Ghi nhận: create, update, publish, unpublish, delete, discardDraft
- Hỗ trợ admin & API user, lưu before/after cho audit

### Version Snapshot & Restore
- Tự động snapshot khi create/update/publish/delete
- Giao diện Recovery: xem chi tiết, phục hồi phiên bản cũ
- Đánh giá % khôi phục: fields, relations, media, dynamic zone

---

## Cài đặt

1. **Bật plugin** trong `config/plugins.ts`:

```typescript
presence: {
  enabled: true,
  resolve: './src/plugins/strapi-plugin-presence',
  config: {
    retentionDays: 90,
    minActionRecords: 500,
    maxVersionsPerDoc: 5,
    snapshotContentTypes: [
      'api::about-page.about-page',
      'api::department.department',
      // ...
    ],
  },
},
```

2. **Build** (chạy từ source):

```bash
cd src/plugins/strapi-plugin-presence
npm install && npm run build
```

3. **Chạy Strapi**:

```bash
cd backend
npm run build && npm run dev
```

---

## Cấu hình

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `retentionDays` | 90 | Ngày giữ action history & versions trước cleanup |
| `minActionRecords` | 500 | Số action tối thiểu trước khi cleanup |
| `maxVersionsPerDoc` | 5 | Version tối đa mỗi document (cũ nhất bị xóa trước) |
| `snapshotContentTypes` | [] | UIDs Single/Collection types cần snapshot |

### Quyền

Restore yêu cầu `plugin::presence.restore` → **Settings > Roles**.

### Biến môi trường

| Biến | Ghi đè |
|------|--------|
| `PRESENCE_RETENTION_DAYS` | `retentionDays` |
| `PRESENCE_MIN_ACTION_RECORDS` | `minActionRecords` |
| `PRESENCE_MAX_VERSIONS_PER_DOC` | `maxVersionsPerDoc` |

---

## Cấu trúc plugin

```
strapi-plugin-presence/
├── admin/src/
│   ├── components/     # PresenceAvatars, PublishHistoryButton, RecoveryView, DetailModal
│   ├── pages/         # ActionHistoryPage
│   └── index.ts
├── server/
│   ├── audit.ts, audit-auth.ts
│   ├── content-types/   # action-history, version
│   ├── services/        # history, retention, restore-steps
│   └── index.ts
└── VERSION-RESTORE.md
```

---

## API Endpoints

Prefix: `/presence` hoặc `/api/presence`

### Version & Restore

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/list?documentId=&contentType=` | Danh sách versions |
| GET | `/assess/:versionId` | Đánh giá version (%) |
| GET | `/version/:documentId` | Chi tiết version |
| GET | `/restore-stream/:versionId?token=` | SSE stream restore |
| POST | `/restore` | Restore (body: `versionId`) |
| POST | `/cancel-restore` | Hủy restore (body: `token`) |
| GET/POST | `/snapshot-now?contentType=&locale=` | Snapshot thủ công (debug) |

### Action History

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/action-history` | Danh sách |
| GET | `/action-history/:id` | Chi tiết |

---

## Version Snapshot & Restore

**Snapshot lưu:** fields thông thường, components, dynamic zones, danh sách `documentId` relations (không clone bản ghi liên quan).

**Restore làm:** ghi đè fields, gán lại relations theo ID, giữ thứ tự many-to-many. Relations mới (không có trong version cũ) bị remove.

**Không làm:** khôi phục nội dung đã sửa của relation, tạo relation cho bản ghi đã xóa.

→ Chi tiết: [VERSION-RESTORE.md](./VERSION-RESTORE.md)

---

## Phát triển

```bash
npm run watch    # Watch mode
npm run verify   # Kiểm tra plugin
```

**Dependencies:** `socket.io` (realtime), `@strapi/design-system`, `@strapi/icons` (Admin UI)
