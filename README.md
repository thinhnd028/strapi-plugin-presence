# Strapi 5 Presence Plugin

Plugin cho Strapi 5 cung cấp: **Real-time presence** (ai đang xem/sửa entry), **Action History** (audit log), và **Version Snapshot & Restore** (khôi phục phiên bản cũ).

---

## Mục lục

1. [Tính năng](#tính-năng)
2. [Cài đặt](#cài-đặt)
3. [Cấu hình](#cấu hình)
4. [Cấu trúc plugin](#cấu-trúc-plugin)
5. [API Endpoints](#api-endpoints)
6. [Version Snapshot & Restore](#version-snapshot--restore)
7. [Phát triển](#phát-triển)

---

## Tính năng

### Real-time Presence
- Hiển thị avatars của user đang xem/sửa cùng entry trong Content Manager
- Typing indicators
- Socket.io, deduplication nhiều tab

### Action History
- Ghi nhận mỗi thao tác: create, update, publish, unpublish, delete, discardDraft
- Hỗ trợ admin user và API user
- Lưu before/after data cho audit

### Version Snapshot & Restore
- Tự động chụp snapshot khi create/update/publish/delete
- Giao diện Recovery xem chi tiết và phục hồi phiên bản cũ
- Đánh giá % khôi phục: fields, relations, media, dynamic zone blocks

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
      // ... thêm content types cần snapshot
    ],
  },
},
```

2. **Build plugin** (nếu chạy từ source):

```bash
cd src/plugins/strapi-plugin-presence
npm install
npm run build
```

3. **Build Strapi admin**:

```bash
cd backend
npm run build
npm run dev
```

---

## Cấu hình

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `retentionDays` | 90 | Số ngày giữ action history và versions trước khi xóa |
| `minActionRecords` | 500 | Số action tối thiểu trước khi chạy cleanup |
| `maxVersionsPerDoc` | 5 | Số version tối đa mỗi document (cũ nhất bị xóa trước) |
| `snapshotContentTypes` | [] | UIDs của Single/Collection types cần lưu snapshot |

### Quyền (RBAC)

Tính năng **phục hồi (restore)** yêu cầu quyền `plugin::presence.restore`. Cấp quyền tại **Settings > Administration panel > Roles** cho role cần sử dụng restore.

### Biến môi trường

- `PRESENCE_RETENTION_DAYS`
- `PRESENCE_MIN_ACTION_RECORDS`
- `PRESENCE_MAX_VERSIONS_PER_DOC`

---

## Cấu trúc plugin

```
strapi-plugin-presence/
├── admin/
│   └── src/
│       ├── components/
│       │   ├── PresenceAvatars.tsx    # Avatar real-time
│       │   ├── PublishHistoryButton.tsx  # Nút mở Recovery
│       │   ├── RecoveryView.tsx       # Giao diện đánh giá & restore
│       │   └── DetailModal.tsx        # Modal chi tiết action
│       ├── pages/
│       │   └── ActionHistoryPage.tsx  # Trang lịch sử hành động
│       └── index.ts
├── server/
│   ├── audit.ts           # Middleware: action log + snapshot
│   ├── audit-auth.ts      # Lifecycle: login/logout
│   ├── config/
│   ├── content-types/
│   │   ├── action-history/
│   │   └── version/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   │   ├── history-service.ts    # Version, assess, restore
│   │   ├── retention-service.ts  # Cleanup theo retention
│   │   └── restore-steps.ts      # Types cho restore
│   └── index.ts
├── VERSION-RESTORE.md     # Chi tiết logic snapshot/restore
└── README.md
```

---

## API Endpoints

Tất cả endpoints dưới prefix `/presence` (hoặc `/api/presence`).

### Version & Restore

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/list?documentId=&contentType=` | Danh sách versions của document |
| GET | `/assess/:versionId` | Đánh giá version (fields, relations, media, %) |
| GET | `/version/:documentId` | Chi tiết một version |
| GET | `/restore-stream/:versionId?token=` | SSE stream restore (step-by-step) |
| POST | `/restore` | Restore (body: `versionId`) |
| POST | `/cancel-restore` | Hủy restore đang chạy (body: `token`) |
| GET/POST | `/snapshot-now?contentType=&locale=` | Chụp snapshot thủ công (debug) |

### Action History

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/action-history` | Danh sách action log |
| GET | `/action-history/:id` | Chi tiết một action |

---

## Version Snapshot & Restore

### Snapshot lưu gì?

- **Fields thông thường**: string, number, richtext…
- **Components / dynamic zones**
- **Danh sách documentId** của relations (không clone bản ghi liên quan)

### Restore làm gì?

- Ghi đè toàn bộ fields
- Gán lại relations theo danh sách ID đã lưu
- Relations mới (không có trong version cũ) bị remove
- Thứ tự many-to-many được giữ

### Những gì KHÔNG làm

- Không khôi phục nội dung đã sửa của bản ghi relation
- Không tạo lại relation nếu bản ghi đó đã bị xóa

Chi tiết: [VERSION-RESTORE.md](./VERSION-RESTORE.md)

---

## Phát triển

```bash
# Watch mode
npm run watch

# Verify plugin
npm run verify
```

### Dependencies

- `socket.io`, `socket.io-client` – Real-time
- `@strapi/design-system`, `@strapi/icons` – Admin UI
