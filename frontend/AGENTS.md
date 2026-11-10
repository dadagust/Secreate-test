# Frontend

React, TypeScript и Vite. Из корня: `npm --prefix frontend ci`, `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build`. Для изменений сессии и запросов запускайте `npm --prefix frontend run test:session` с Vite и Chrome; для сквозных сценариев — `npm --prefix frontend run test:browser` с backend и эмулятором. Проверяйте состояния загрузки, ошибок и доступность интерфейса.

`src/styles/` — единственный источник всех визуальных значений и CSS. Токены оформляйте CSS-переменными по смысловым файлам, компоненты используют семантические классы или типизированные варианты. Запрещены JSX `style`, CSS-in-JS, изменение `element.style` и визуальные константы в компонентах; ESLint проверяет JSX и обращения к `.style`. Выделяйте модуль при самостоятельной ответственности, поведении или повторном использовании; простую локальную разметку оставляйте рядом. Дизайн-код и адаптивные правила — в [документации](../docs/project/frontend.md).

