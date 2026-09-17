# помойка.inc — Frontend

Фронтенд на **React + TypeScript + Vite**.

## Документация

Архитектура проекта, структура папок, компоненты и стили:

- 🇷🇺 [Русская версия](docs/FRONTEND_ARCHITECTURE.md)
- 🇬🇧 [English version](docs/FRONTEND_ARCHITECTURE_EN.md)

## Стек

- **React** + **TypeScript**
- **Vite** — сборка и дев-сервер с HMR
- **Oxlint** — линтинг (см. ниже)

## Запуск

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

## Линт

```bash
npm run lint
```

Сейчас доступны два официальных плагина для Vite:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) — на базе [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) — на базе [SWC](https://swc.rs/)

## React Compiler

React Compiler в этом шаблоне **не включён** — он заметно влияет на скорость дев-сервера и сборки. Если нужно включить, см. [официальную документацию](https://react.dev/learn/react-compiler/installation).

## Расширение конфигурации Oxlint

Для продакшен-проекта рекомендуется включить type-aware правила линтера. Для этого установите `oxlint-tsgolint` и отредактируйте `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

Полный список правил и категорий — в [документации Oxlint](https://oxc.rs/docs/guide/usage/linter/rules).
