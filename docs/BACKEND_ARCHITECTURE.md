# Backend

## Стек

ASP.NET Core 9 · EF Core 9 · PostgreSQL (Npgsql) · ASP.NET Identity (GUID keys) · JWT bearer · RustFS (S3 API) · SignalR · Swagger (dev)

## Рантайм

`Program.cs` регистрирует БД, Identity, JWT, storage, сервисы, SignalR, контроллеры. На старте: применяются EF-миграции, гарантируется роль `Admin`, при наличии `ADMIN_EMAIL` назначается ей.

Пайплайн: REST (`/api`) · SignalR (`/hubs/feed`) · Swagger UI (dev) · CORS для настроенных origin'ов.

JWT также принимается через query-параметр `access_token` для SignalR и файловых запросов, где браузер не может отправить заголовок.

## Структура

```text
backend/
├── Dockerfile
├── Dockerfile.dev
├── docs/
│   ├── BACKEND_ARCHITECTURE.md
│   └── API.md
└── src/Feed.Api/
    ├── Controllers/   HTTP-эндпоинты
    ├── Data/           EF Core DbContext
    ├── Hubs/            SignalR
    ├── Migrations/     EF Core миграции
    ├── Models/          сущности и DTO
    ├── Services/         бизнес/инфраструктурная логика
    ├── Program.cs        DI и middleware
    └── appsettings.json локальные настройки
```

`bin/`, `obj/` — build-артефакты.

## Модули

**Auth** — `AuthController`: инвайт-коды, регистрация, логин, refresh, профиль, presence. Identity хранит пользователей/роли в PostgreSQL. Frontend шлёт `Authorization: Bearer <token>`.

**Feed/Posts** — `PostsController`: дневная лента, postishki, статьи, публичные статьи, посты пользователя, создание/удаление, редактирование статей. `CommentsController` — комментарии. `ReactionsController` — лайки.

**Архив** — `PomoykaService` создаёт дневной контейнер и переносит устаревший контент в архив внутри serializable-транзакции. `ArchivalBackgroundService` догоняет пропущенные дни после рестарта и далее работает по расписанию. Архивные файлы переиспользуют storage key — бинарник не копируется.

**Files** — `FilesController`: presigned uploads, личная библиотека, папки, видимость, метаданные, аватары, баннеры, скачивание. `StorageService` — RustFS через S3 API. `FileMetadataBackfillService` чинит/дозаполняет метаданные. `AvatarImageOptimizer` — обработка изображений.

**Admin** — `AdminController`: запуск архивации, управление пользователями, инвайт-коды, баннеры и голосования сайдбара, квоты, storage settings. Требует роль `Admin`.

**Realtime** — `FeedHub` на `/hubs/feed`. Публикует обновления ленты через SignalR-группы; клиент трактует их как уведомление и перезапрашивает данные через REST. Изменения баннеров и голосований сайдбара отправляются событием `FeedSidebarChanged`.

## Данные и миграции

Модель — `Data/AppDbContext.cs`. Схема — `Migrations/`.

```bash
dotnet ef migrations add <MigrationName> --project backend/src/Feed.Api
dotnet ef database update --project backend/src/Feed.Api
dotnet build backend/src/Feed.Api/Feed.Api.csproj
```

Dev-контейнер применяет миграции на старте. Прод — ревью миграций перед раскаткой.

## Конфигурация

`appsettings.json` / env / Docker Compose:

- `ConnectionStrings__DefaultConnection`
- `Jwt__Secret`, `Jwt__Issuer`, `Jwt__Audience`
- `Minio__Endpoint`, `Minio__PublicEndpoint`, `Minio__AccessKey`, `Minio__SecretKey`, `Minio__Bucket`, `Minio__UseSSL` (legacy configuration section; points to RustFS)
- `Imgproxy__Endpoint` (internal imgproxy URL used by the background image-preview worker)
- `ADMIN_EMAIL`

Секреты — только в `.env`, никогда в коде.

## Локальный запуск

```bash
cp .env.example .env
docker compose up --build
```

Dev-compose поднимает PostgreSQL, RustFS, imgproxy, API (`dotnet watch`). API — `http://localhost:5000`, S3 API — `localhost:9000`, консоль RustFS — `localhost:9001`.

Превью изображений генерируются в фоне через imgproxy после загрузки и сохраняются в RustFS под `previews/`. Imgproxy читает оригиналы по внутреннему HTTP endpoint хранилища, доступному для чтения согласно политике bucket; API использует свои S3 credentials только для сохранения результата. Запросы чтения не запускают генерацию; при старте API фоновый сервис также ставит в очередь сохранённые изображения без готового превью.

## Добавление фичи

1. Сущности → `Models/`, связи → `AppDbContext`.
2. Миграция при изменении схемы.
3. Бизнес/инфра-логика → `Services/`.
4. Контроллеры — только HTTP и маппинг DTO.
5. Обновить `API.md` при изменении маршрута или auth-правил.
6. Проверить `dotnet build` + сборку frontend.
