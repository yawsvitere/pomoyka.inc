# API

Base URL: `http://localhost:5000`

Все маршруты под `/api`, если не указано иное. Приватные требуют `Authorization: Bearer <access_token>`. Публичные помечены отдельно.

## Health и баннеры

| Метод | Маршрут | Доступ | Назначение |
|---|---|---|---|
| GET | `/api/health` | Публично | Проверка здоровья |
| GET | `/api/banners` | Публично | Активные баннеры ленты |

## Авторизация и профиль

База: `/api/auth`

| Метод | Маршрут | Доступ | Назначение |
|---|---|---|---|
| POST | `/verify-code` | Публично | Проверка инвайт-кода |
| POST | `/register` | Публично | Регистрация |
| POST | `/login` | Публично | Выдача access/refresh токенов |
| GET | `/me` | Пользователь | Текущий профиль |
| PUT | `/me` | Пользователь | Обновление профиля |
| PUT | `/password` | Пользователь | Смена пароля |
| POST | `/refresh` | Публично | Обновление access-токена |
| POST | `/heartbeat` | Пользователь | Обновление присутствия онлайн |
| POST | `/welcome-seen` | Пользователь | Отметка welcome-флоу пройденным |
| GET | `/presence` | Пользователь | Информация о присутствии |
| GET | `/profile/{displayName}` | Пользователь | Чужой профиль |

## Посты и лента

База: `/api/posts`

| Метод | Маршрут | Доступ | Назначение |
|---|---|---|---|
| GET | `/` | Пользователь | Дневная лента с пагинацией |
| GET | `/postishki` | Пользователь | Лента postishki |
| GET | `/{id}` | Пользователь | Чтение поста |
| GET | `/public/{id}` | Публично | Публичная статья |
| POST | `/article` | Пользователь | Создание статьи |
| POST | `/` | Пользователь | Создание поста |
| GET | `/by-user` | Пользователь | Посты пользователя |
| DELETE | `/{id}` | Владелец/Admin | Удаление поста |
| PUT | `/{id}/article` | Пользователь | Редактирование статьи |

Комментарии — `/api/posts/{postId}/comments`:
- `POST` — создать комментарий
- `DELETE /{id}` — удалить (по правам владения/роли)

Реакции — `/api/reactions`:
- `PUT /post/{postId}` — переключить реакцию

Поиск — `GET /api/search` — поиск по ленте и библиотеке.

## Архив

База: `/api/archive`

| Метод | Маршрут | Доступ | Назначение |
|---|---|---|---|
| GET | `/calendar/{year}/{month}` | Публично | Дни и счётчики за месяц |
| GET | `/{year}/{month}/{day}` | Публично | Посты за день, с пагинацией |
| GET | `/post/{id}` | Публично | Полный архивный пост |

## Файлы и хранилище

База: `/api/files`. Presigned-загрузки, личная библиотека, папки, приватность, скачивание, медиа профиля.

| Метод | Маршрут | Назначение |
|---|---|---|
| POST | `/presign-upload` | Target для загрузки файла к посту |
| GET | `/library` | Библиотека пользователя |
| GET | `/quota` | Квота хранилища |
| GET | `/profile/{displayName}/library` | Видимая библиотека профиля |
| GET | `/pinterest` | Медиа для Pinterest-режима |
| POST | `/folders` | Создать папку |
| POST | `/library/upload` | Загрузить файл в библиотеку |
| PATCH | `/library/{id}/visibility` | Изменить видимость файла |
| PATCH | `/library/{id}/name` | Переименовать файл |
| PATCH | `/library/{id}/folder` | Переместить файл |
| DELETE | `/library/{id}` | Удалить файл из библиотеки |
| DELETE | `/{id}` | Удалить запись файла |
| PATCH | `/folders/{id}/visibility` | Изменить видимость папки |
| PATCH | `/folders/{id}/name` | Переименовать папку |
| DELETE | `/folders/{id}` | Удалить папку |
| GET | `/gallery/{folderId}` | Галерея папки |
| GET | `/library/{id}/download` | Скачать файл из библиотеки |
| GET | `/sha256/{hash}/download` | Скачать по дедупликации |
| GET | `/post/{id}/download` | Скачать файл поста |
| GET | `/archive/{id}/download` | Скачать архивный файл |
| POST | `/post/{postId}` | Прикрепить файл к посту |
| POST | `/avatar` | Загрузить аватар |
| POST | `/banner` | Загрузить баннер |
| GET | `/avatar/{userId}` | Отдать аватар |
| GET | `/banner/{userId}` | Отдать баннер профиля |

## Администрирование

База: `/api/admin`. Все маршруты требуют роль `Admin`.

- `POST /archive/today` — архивация дня
- `GET /users` — список пользователей
- `PUT /users/{id}/role` — смена роли
- `PUT /users/{id}/storage-quota` — смена квоты
- `GET /storage-summary` — сводка по хранилищу
- `PUT /storage-settings` — настройки хранилища
- `POST /invite-codes`, `GET /invite-codes`, `DELETE /invite-codes/{id}` — инвайт-коды
- `GET /banners`, `POST /banners`, `DELETE /banners/{id}` — баннеры

## Realtime API

SignalR hub: `/hubs/feed`

JWT можно передать в query-параметре `access_token` при negotiate/подключении. Обновления ленты идут через SignalR-группы; REST остаётся источником истины.

## Конвенции ответов

- Ошибки валидации/авторизации — стандартные коды ASP.NET Core + JSON `message` где применимо
- Пагинация архива: `page`, `pageSize`, `total`, `totalPages`
- File DTO отдают URL для скачивания, не storage-креды
- ID — GUID. Даты — JSON-сериализация по умолчанию; даты календаря архива — date-only