<div align="center">

<img src="./frontend/public/trash.svg" width="72" height="72" alt="помойка.inc logo" />

# помойка.inc

**Закрытое место для своих: лента, хранилище, архив, пинтерест.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![.NET](https://img.shields.io/badge/backend-ASP.NET%20Core%209-512BD4)
![React](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-61DAFB)
![Docker](https://img.shields.io/badge/infra-Docker%20Compose-2496ED)

</div>

---

## Что это

Приватный аналог тг: шитпост, хранилище файлов, статьи. Доступ только по инвайт-коду.

- **Шитпост** — можно шитпостить в главную ленту а на следующий день посты пропадут.
- **Хранилище** — файлы, фото, видео, музыка, статьи; публичное или приватное на выбор.
- **Архив событий** \* календарь, фотоотчёты, материалы.

## Установка на Linux-сервере

Выполните одну команду от пользователя с `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/yawsvitere/pomoyka.inc/main/install.sh | sudo bash
```

Установщик при необходимости поставит Docker, скачает только production Compose,
спросит email администратора и публичный адрес сайта для S3 (например,
`example.com` за внешним nginx или `203.0.113.10:3000` при прямом доступе),
затем создаст закрытый `.env` со случайными секретами и запустит приложение на порту `3000`.
Исходный код на сервер не клонируется, production-образы не собираются.

При первом запуске GitHub Actions публикует frontend и backend в GitHub Container
Registry (GHCR). Сделайте пакеты `pomoyka-inc-backend` и `pomoyka-inc-frontend`
публичными в настройках пакетов GitHub, иначе серверу потребуется `docker login ghcr.io`.
Для обновления повторно выполните команду установщика: существующий `.env` сохранится,
а образы будут загружены заново.

Единственный опубликованный порт приложения — `3000`; внешний nginx можно направить
на `http://127.0.0.1:3000`.

## Ручная установка

```bash
cp .env.example .env
docker compose up --build
```

Нужен Docker + Docker Compose ([Docker Desktop](https://www.docker.com/products/docker-desktop/) на Windows/macOS, [Docker Engine](https://docs.docker.com/engine/install/) на Linux).

### Production

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Для сервера укажи публичный адрес S3-хранилища:

```dotenv
S3_PUBLIC_ENDPOINT=example.com
```

При обновлении со старой установки MinIO не подключайте её `minio_data` как
том RustFS: форматы данных несовместимы. Старый том останется на месте, но
данные нужно перенести через S3 API до переключения.

Compose запускает RustFS с одним локальным томом; для защиты от отказа диска
настройте отдельное резервное копирование данных.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
