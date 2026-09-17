# Фронт

## Стек

React 19 + TypeScript · Vite · React Router 7 · Axios · SignalR · TipTap · Video.js · react-photo-view

## Структура

```text
frontend/
├── public/          статика, manifest
├── src/
│   ├── api/          HTTP-клиент, типы, модули API
│   ├── assets/        иконки, локальные ресурсы
│   ├── components/    компоненты по доменам
│   ├── context/        глобальные контексты
│   ├── pages/          экраны/маршруты
│   ├── styles/          core / components / pages
│   ├── utils/           fileUrl, safeHtml
│   ├── App.tsx           роутинг, route guards
│   └── main.tsx           entry point
└── ../docs/          документация репозитория
```

## Роутинг

`App.tsx` лениво грузит страницы (`React.lazy`), три группы маршрутов:

- **Гостевые** — `/login`, `/register`, `/register/code`
- **Приватные** — лента, профиль, настройки, посты, архив, файлы, Pinterest
- **Публичные** — `/posts/public/:postId`, `/files/gallery/:folderId`, `/files/file/:fileId`

Guards: `PrivateRoute` (ждёт сессию, редиректит на `/login`), `GuestRoute` (не пускает авторизованных на вход), `AdminRoute` (проверяет роль в JWT).

Экраны: `/`, `/posts`, `/posts/new`, `/posts/:postId`, `/posts/:postId/edit`, `/archive`, `/archive/:year/:month/:day`, `/files`, `/pinterest`, `/profile/:userId`, `/settings`, `/admin`.

## API-слой

`api/client.ts` — общий Axios-клиент и авторизация. Остальное разбито по backend-модулям: `auth.ts`, `posts.ts`, `archive.ts`, `files.ts`, `admin.ts`, `search.ts`, `types.ts`.

URL файлов собираются только через `utils/fileUrl.ts`. HTML из редактора санитизируется через `utils/safeHtml.ts`.

## Layout и состояние

`PrivateLayout` — header, боковая навигация, мобильное меню. `AuthContext` — текущий пользователь, сессия, login/logout, профиль.

`feed/` — карточки постов, комментарии, контекстные меню, composer. `editor/` — изоляция TipTap. `calendar/` — элементы архива.

Стили: `core` — токены и база, `components` — переиспользуемые компоненты, `pages` — экраны. Новый глобальный стиль — только если не хватает существующего токена/класса.

## Realtime

SignalR обновляет UI или триггерит перезагрузку данных. Источник истины для пагинации и мутаций — всегда REST API.

## Команды

```bash
npm install
npm run dev
npm run build
npm run lint
```

Полный стек — `docker compose up --build` из корня репозитория.

## Правила изменений

1. Новый экран → `pages/` + регистрация в `App.tsx`.
2. Повторяемые API-операции → соответствующий модуль `api/`.
3. DTO по backend-контракту → `api/types.ts`.
4. Стили нового компонента → `styles/components`.
5. Состояние — локальное, если не используется несколькими экранами.
6. После изменения маршрутов/API — обновить документацию и прогнать `npm run build`.