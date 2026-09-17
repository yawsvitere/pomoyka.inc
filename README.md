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
- **Архив событий** * календарь, фотоотчёты, материалы.

## Установка (потом билды выкачу, пока бета но можно уже)

```bash
git clone https://github.com/yawsvitere/pomoyka.inc
cd pomoyka.inc
cp .env.example .env
docker compose up --build
```

Нужен Docker + Docker Compose ([Docker Desktop](https://www.docker.com/products/docker-desktop/) на Windows/macOS, [Docker Engine](https://docs.docker.com/engine/install/) на Linux).

Для реального использования замени в `.env`: `JWT_SECRET`, пароли PostgreSQL и MinIO.

Но токо appsettings.json заменить надо будет если есть желание поменять пароли PostgreSQL и MinIO

### Production

```bash
docker compose -f docker-compose.prod.yml up -d --build
```


Для сервера укажи публичный адрес MinIO:

```dotenv
MINIO_PUBLIC_ENDPOINT=example.com
```


## Лицензия

MIT — см. [LICENSE](./LICENSE).