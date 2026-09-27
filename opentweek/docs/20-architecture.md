# Архитектура opentweek: local-first планировщик с Android-оболочкой без Gradle

Актуальность исследования: 27 сентября 2026 года.

## 1. Основной вывод

opentweek — одно React-приложение, которое хранит все данные в IndexedDB устройства и работает в двух оболочках: браузер (PWA) и собственная Android-оболочка на `WebView` с Java-мостом. Сервера нет.

При этом такая схема решает не всё. Она не даёт:

- синхронизации между устройствами и общих календарей (ADR-0009);
- напоминаний в браузере при закрытой вкладке: нужен push-сервер;
- двусторонней связи с Google Calendar: только чтение по секретной ICS-ссылке;
- гарантии доставки напоминаний на прошивках, которые убивают будильники фоновых приложений.

Схема:

```text
                 React 19 UI (src/components, src/App.tsx)
                              │
          ┌───────────────────┼─────────────────────┐
          │                   │                     │
   src/actions.ts      src/lib/*              src/native.ts
   мутации, DnD,       recurrence, ics,       единый фасад платформы
   rollover            share, backup, dates         │
          │                                         │
       Dexie 4 ── IndexedDB                 ┌───────┴────────┐
                                            │                │
                                        браузер       window.OpenTweekNative
                                   (Notification,     (Android, NativeBridge.java)
                                    download, fetch)        │
                                                 AlarmManager · Intents · HttpURLConnection
```

Для MVP достаточно веб-версии и APK из `android/build.sh`. Для распространения за пределами личного использования нужны приватный ключ подписи (ADR-0006) и `targetSdk` 35+ через Gradle (ADR-0005).

## 2. Почему не «просто PWA»

PWA ставится на Android из Chrome и даёт офлайн-режим без APK. Для планировщика этого недостаточно:

- уведомление из PWA требует активного service worker и push-сервера; локальный таймер в странице живёт только пока вкладка открыта;
- у PWA нет доступа к `AlarmManager`, поэтому напоминание на 09:00 при выключенном экране не сработает;
- загрузка ICS-ленты Google из браузера упирается в CORS: `calendar.google.com` не отдаёт `Access-Control-Allow-Origin`, нужен прокси.

PWA остаётся основным способом использования на ноутбуке и на iOS. Сценарий 2 из PRD (напоминание при закрытом приложении) закрывает только APK.

## 3. Варианты Android-оболочки

### 3.1. Capacitor 8 (отклонён)

Назначение: готовая оболочка с плагинами уведомлений, файлов, шаринга.
Преимущества: плагины поддерживаются сообществом, MIT.
Ограничения: сборка только через Gradle и Android Gradle Plugin из Google Maven. В среде разработки `dl.google.com` и `maven.google.com` закрыты, GitHub Actions на аккаунте не запускаются. См. ADR-0004.

### 3.2. Trusted Web Activity (отклонён)

Назначение: APK-обёртка над сайтом в Chrome.
Преимущества: минимальный код.
Ограничения: нужен публичный HTTPS-хостинг и Digital Asset Links; нет нативных будильников; данные живут в профиле Chrome, а не в приложении.

### 3.3. Своя оболочка на WebView (выбран)

Назначение: `Activity` с `WebView`, бандл из `assets/www`, мост `@JavascriptInterface`.
Преимущества: около 670 строк Java; собирается инструментами из архива Ubuntu за 3 с; APK 348 КБ; нет сторонних нативных зависимостей.
Ограничения: компиляция против `android.jar` API 23, поэтому API 24–34 вызываются через рефлексию; `targetSdk 34`; поддержка кода своими силами. См. ADR-0005.

Раздача локального контента в WebView по HTTPS-адресу вместо `file://` — рекомендованный Android подход: `file://` и `data:` дают «непрозрачный» origin и ломают same-origin. Официально рекомендован хост `appassets.androidplatform.net` через `WebViewAssetLoader` из AndroidX. AndroidX недоступен (нет Google Maven), поэтому тот же механизм реализован напрямую через `WebViewClient.shouldInterceptRequest` на хосте `app.opentweek.local`. Зона `.local` зарезервирована под mDNS и не разрешается в публичном DNS, поэтому запрос мимо перехватчика не уйдёт к постороннему серверу.

Загрузка локального контента в WebView:  
https://developer.android.com/develop/ui/views/layout/webapps/load-local-content

`WebViewClient.shouldInterceptRequest` (API 21):  
https://developer.android.com/reference/android/webkit/WebViewClient

## 4. Структура веб-приложения

### 4.1. Модель данных

Таблицы Dexie (`src/db.ts`, версия схемы 1):

```text
tasks      id, calendarId, date, listId, updatedAt
lists      id, calendarId, order
calendars  id, order
feeds      id
kv         key            (settings)
```

Пример задачи, повторяющейся по будням, с одним пропущенным и одним выполненным повтором:

```json
{
  "id": "00000000-example-task",
  "calendarId": "00000000-example-cal",
  "title": "Зарядка",
  "done": false,
  "date": "2026-09-21",
  "listId": null,
  "order": 2,
  "color": "green",
  "note": "",
  "subtasks": [{ "id": "sub-example", "title": "Растяжка", "done": false }],
  "attachments": [],
  "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "exdates": ["2026-09-24"],
  "doneDates": ["2026-09-22"],
  "reminder": "07:30",
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

Инварианты:

- ровно одно из `date`, `listId` не `null`;
- `rrule` не `null` только при `date` не `null`;
- у задачи с `rrule` поле `done` не используется, выполнение хранится в `doneDates`;
- `order` — вещественное число, сравнивается внутри контейнера.

### 4.2. Строки и контейнеры

Строка на экране — `Item`: задача или один повтор серии. Ключ повтора: `<taskId>@<yyyy-MM-dd>`. Контейнер DnD: `day:<yyyy-MM-dd>` или `list:<listId>`.

```text
expand(tasks, from, to)      → Item[] видимого диапазона
containerOf(item)            → ContainerId
moveItem(item, target, i, …) → перенос + перенумерация
detachOccurrence(item, …)    → exdate в серии + новая задача
interleaveOrders(slots)      → порядок вокруг повторов, которые двигать нельзя
rollover(calendarId, today)  → невыполненные прошлые задачи на сегодня
```

### 4.3. Модули

```text
src/actions.ts        все записи в БД
src/lib/recurrence.ts rrule ↔ пресеты и редактор, expand(), describe()
src/lib/ics.ts        экспорт VEVENT, разбор лент и импорт задач (ical.js)
src/lib/share.ts      #share=<deflate-raw base64url>
src/lib/backup.ts     JSON-бэкап со вложениями в data URL
src/i18n.ts           словари en/ru, t(), fmt(), fmtWeekday()
src/lib/quickadd.ts   разбор фраз голоса и «Поделиться»: день, время, повтор
src/native.ts         фасад платформы: saveFile, shareText, fetchText, listen, onExternalIntent, напоминания, «назад»
src/hooks/            живые запросы, фоновые эффекты, тосты
```

Запрещённые пути: компоненты не пишут в `db` напрямую, кроме переименования списков и календарей в настройках. Любая новая запись идёт через `src/actions.ts`, чтобы оставаться покрытой тестами.

## 5. Нативный мост (`window.OpenTweekNative`)

### 5.1. Что делает

```text
platform()                         → "android"
notificationsAllowed()             → boolean
requestNotifications()             → ответ через window.__otNotifResult(granted)
setReminders(json)                 → заменить расписание будильников целиком
share(title, text)                 → системное «Поделиться»
saveFile(name, mime, base64)       → системное «Сохранить как» (ACTION_CREATE_DOCUMENT)
fetchText(id, url)                 → ответ через window.__otFetch(id, ok, text)
takeIntent()                       → JSON внешнего события, один раз (см. 5.4)
voiceAvailable()                   → есть ли приложение распознавания речи
startVoice(lang, prompt)           → ответ через window.__otVoice(ok, text)
minimize()                         → свернуть приложение
```

Обратные вызовы из Java в страницу:

```text
window.__otBack()          → true, если закрыт диалог; иначе оболочка сворачивает приложение
window.__otNotifResult(b)  → результат запроса POST_NOTIFICATIONS
window.__otFetch(id,ok,s)  → результат fetchText
window.__otVoice(ok, s)    → распознанная фраза; "" при отмене
event "ot-intent"          → новое внешнее событие при запущенном приложении
```

Пример расписания, которое страница передаёт в `setReminders`:

```json
[
  {
    "id": 1432265370,
    "at": 1790659800000,
    "title": "Зарядка",
    "body": "07:30",
    "taskId": "00000000-example-task",
    "date": "2026-09-29"
  }
]
```

`id` — 32-битный хэш ключа повтора (`hashId` в `src/native.ts`): тот же повтор получает тот же `id`, и будильник перезаписывается, а не дублируется.

### 5.2. Чего не делает

- не выполняет произвольный JavaScript или Java, присланный страницей;
- не читает и не пишет файлы по путям: только через системный выбор файла или документа;
- не ходит по URL, кроме `http://` и `https://`, и не читает больше 8 МБ;
- не хранит задачи: единственный источник правды — IndexedDB в WebView.

### 5.3. Напоминания

```text
страница: tasks изменились
→ upcomingReminders(tasks): 30 дней вперёд, не более 100, только не выполненные
→ OpenTweekNative.setReminders(json)
→ Reminders.replace: отменить прошлые PendingIntent, сохранить JSON в SharedPreferences
→ AlarmManager.setExactAndAllowWhileIdle(RTC_WAKEUP, at, pi)
   при SecurityException → setAndAllowWhileIdle (неточный)
→ ReminderReceiver: Notification в канале "reminders"; тап открывает задачу
перезагрузка или обновление APK → BootReceiver → Reminders.restore
```

`setExactAndAllowWhileIdle` добавлен в API 23 и срабатывает в режиме Doze.  
https://developer.android.com/reference/android/app/AlarmManager

`USE_EXACT_ALARM` для приложений с targetSdk 33+ выдаётся автоматически и не отзывается пользователем. Предназначен для будильников и календарей и ограничен политикой Google Play. Будильники сбрасываются при выключении устройства, поэтому их восстанавливают по `BOOT_COMPLETED`.  
https://developer.android.com/develop/background-work/services/alarms/schedule

Изменения точных будильников в Android 14:  
https://developer.android.com/about/versions/14/changes/schedule-exact-alarms

`POST_NOTIFICATIONS` — runtime-разрешение с Android 13:  
https://developer.android.com/develop/ui/views/notifications/notification-permission

### 5.4. Внешние события и голос

```text
тап по уведомлению       → {"kind":"task","taskId":"…","date":"2026-09-29"}
ярлык «Голосовая задача» → {"kind":"voice"}   action app.opentweek.action.VOICE
ярлык «Новая задача»     → {"kind":"new"}     action app.opentweek.action.NEW
«Поделиться» текстом     → {"kind":"text","text":"…"}  ACTION_SEND text/plain, AUTO_SEND
```

Конвейер голосовой задачи:

```text
кнопка микрофона | клавиша V | ярлык «Голосовая задача»
→ listen(lang): Android — RecognizerIntent (сервис Google), браузер — SpeechRecognition
→ parseQuickAdd(фраза, now): { title, date, reminder, rrule }
→ addQuickTask(calendarId, parsed)
→ переход к неделе задачи, тост «Добавлено: … — пн 28 сент., 09:00» с кнопкой «Открыть»
```

Что разбирает `parseQuickAdd` (ru и en в любой фразе):

```text
командные слова    «окей гугл, напомни мне», «добавь задачу», "remind me to", "add task"
дни                сегодня, завтра, послезавтра, в/во/на <день недели>, через N дней, через неделю,
                   5 октября, 15.09[.2027]; today, tomorrow, (on|next) <weekday>, Oct 12, 12 Oct, in N days
время              в 9, в 9:30, в 7 вечера, в 3 дня, в полдень; at 6pm, 9:30am, noon; 18:30
момент             через 30 минут, через 2 часа, через полчаса; in 2 hours, in 30 minutes
повторы            каждый день, по будням, каждую неделю, каждые две недели, каждый <день недели>,
                   каждый месяц, каждый год; daily, every weekday, weekly, every other week, every <weekday>
```

Правила разрешения: день недели без «каждый» — ближайший будущий, не сегодняшний; время без дня, которое уже прошло, — завтра; дата без года в прошлом — следующий год. Распознанные фрагменты вырезаются из заголовка. Предлоги в начале остаются: «к стоматологу».

Команда «Окей Google, добавь задачу в opentweek» невозможна без App Actions, а их регистрирует только Google Play Console. См. ADR-0010.  
https://developer.android.com/develop/devices/assistant/overview

## 6. Совместимость и версионирование

- Схема Dexie: версия 1. Любое изменение индексов — новый `this.version(N).stores(...)` с `upgrade()`, старые версии не удаляются.
- Бэкап: `{ app: "opentweek", version: 1 }`. Импорт отклоняет чужие файлы. Новая версия формата обязана читать версию 1.
- Ссылки шаринга: `SharePayload.v = 1`.
- APK: `versionName` из `package.json`, `versionCode = major*10000 + minor*100 + patch` (1.0.0 → 10000). Понижение `versionCode` Android не установит поверх, см. откат в runbook.
- Мост: новые методы только добавляются. Страница проверяет наличие метода, прежде чем звать его, если метод появился после 1.0.
- Android 14 не устанавливает APK с targetSdk ниже 23; у opentweek 34.  
  https://developer.android.com/about/versions/14/behavior-changes-all

## 7. Выполнение операций

Запись задачи:

```text
ввод в строке дня
→ addTask(calendarId, "day:2026-09-29", title)
→ Dexie add
→ useLiveQuery перерисовывает неделю
→ эффект useReminders (через 800 мс) → setReminders на Android
```

Перетаскивание повтора на другой день:

```text
onDragEnd
→ moveItem(occurrence, "day:<другой>", index, targetItems)
→ detachOccurrence: exdates += дата; новая задача без rrule
→ interleaveOrders: порядок новой задачи между соседями, повторы не трогаются
```

Подписка на календарь:

```text
refreshFeed(feed)
→ fetchText(url): Android — HttpURLConnection, браузер — fetch (+ CORS-прокси)
→ parseEvents(text, сегодня−120 дн, сегодня+400 дн): ical.js, раскрытие RRULE и RECURRENCE-ID
→ feeds.events (кэш), обновление каждые 30 минут
```

## 8. Безопасность

Коротко; подробно в `22-security.md`.

| Уровень | Операции | Политика |
|---|---|---|
| L0 | Просмотр, поиск, экспорт | Без подтверждения |
| L1 | Создание и правка задачи, отметка | Без подтверждения |
| L2 | Удаление задачи | Выполняется сразу, отмена в тосте 5 с |
| L3 | Удаление списка или календаря с задачами | `confirm()` с числом задач |
| L4 | Восстановление бэкапа (замена всех данных) | `confirm()`; перед этим пользователь делает экспорт |

Недоверенные данные: ICS-ленты, импортируемые `.ics` и JSON, ссылки `#share=`. Всё отображается только как текст через React, без `dangerouslySetInnerHTML`.

## 9. Ограничения среды

- Сборка: Ubuntu 24.04, пакеты `aapt` 1:14~beta1-2build3, `dalvik-exchange` 10.0.0+r36-4, `zipalign` 1:10.0.0+r36-1ubuntu2, `apksigner` 31.0.2-1ubuntu1, `android-sdk-platform-23` 6.0.1+r72-6ubuntu1, JDK 21.  
  https://packages.ubuntu.com/noble/aapt  
  https://packages.ubuntu.com/noble/android-sdk-platform-23
- `aapt` версии 1 не знает атрибутов новее API 23: `roundIcon`, флаг `density` в `configChanges`, адаптивные иконки не используются.
- `dx` не понимает лямбды без desugaring: Java-код пишется в стиле Java 7 с анонимными классами, `-source 8 -target 8`.
- Сетевая политика среды разработки закрывает `dl.google.com`, `maven.google.com`, MDN, RFC Editor, GitHub Web UI. Ссылки на них в этом паке не проверялись, кроме отмеченных.
- GitHub Actions на аккаунте не запускают задачи. Сборка и публикация только локальные.

## 10. Варианты развёртывания

### 10.1. APK из репозитория (основной)

```text
android/build.sh → releases/opentweek-X.Y.Z.apk (+ .sha256) → git push
телефон: скачать из GitHub → установить → разрешить «Установка неизвестных приложений»
```

Для личного использования. Обновления встают поверх благодаря общему ключу.

### 10.2. Веб на статическом хостинге

```text
npm run build → dist/ → любой статический хостинг (GitHub Pages, Netlify, свой nginx)
```

`BASE_PATH=/opentweek/` для хостинга в подкаталоге. Service worker из `vite-plugin-pwa` кэширует бандл для офлайна. `VITE_PUBLIC_URL` указывает адрес для ссылок шаринга из APK.

### 10.3. Локально

`npm run dev` — для разработки. Данные dev-сервера лежат в origin `localhost:5173` и не пересекаются с продакшеном.

## 11. Тестирование и совместимость

Матрица и обязательные проверки — в `32-test-plan.md`. Сейчас автоматизировано:

- 27 модульных тестов (vitest + fake-indexeddb): повторы, ICS, шаринг, перемещения, перенумерация, i18n, расписание напоминаний, разбор фраз;
- 3 сквозных сценария Playwright в Chromium: десктоп en, мобильный ru с имитацией `OpenTweekNative`;
- проверка APK: `apksigner verify`, `aapt dump badging`.

Не автоматизировано и не выполнялось: запуск APK на устройстве или эмуляторе.

## 12. Open-source референсы

- **WeekToDo** (`manuelernestog/weektodo`, Vue, GPL-3.0). Самый полный открытый недельный планировщик. Взяты только UX-идеи; код несовместим по лицензии.
- **rrule** 2.8.1 (BSD-3-Clause). Взят целиком для повторов. Последний релиз 2023 года: считаем стабильным, но без развития.
- **ical.js** 2.2.1 (MPL-2.0). Разбор ICS, раскрытие `RRULE` и `RECURRENCE-ID`. Файлы библиотеки не изменяются, поэтому MPL не распространяется на код opentweek.
- **Dexie** 4.4.6 (Apache-2.0), **@dnd-kit/core** 6.3.1 (MIT), **date-fns** 4.4.0 (MIT), **vite-plugin-pwa** 1.3.0 (MIT).
- Шрифты **Montserrat** (текст) и **Comfortaa** (заголовки, числа дней) из `@fontsource-variable` 5.3.0 (OFL-1.1). В бандл попадают только подмножества латиницы и кириллицы (`src/fonts.css`), 111 КБ в сумме, без обращения к Google Fonts: шрифты работают офлайн и внутри APK.

Лицензии сверены по файлам `LICENSE` в репозиториях и по `registry.npmjs.org`: сайты проектов из среды недоступны.

Чего нет ни в одном референсе и написано с нуля: Android-оболочка без Gradle, шаринг без сервера, повторы с отвязкой отдельного повтора при перетаскивании.

## 13. Состав 1.0

См. `11-mvp.md`, раздел 2.

## 14. Итоговая рекомендация

```text
IndexedDB (Dexie)      — единственный источник правды, на устройстве
src/actions.ts         — все записи, покрыто тестами
src/lib/recurrence.ts  — повторы: одна запись на серию, вычисление на лету
src/native.ts          — единственная точка, знающая про платформу
NativeBridge.java      — узкий мост: 11 методов, без eval и путей к файлам
quickadd.ts            — голос и «Поделиться» в задачу, без облака
Reminders.java         — будильники ОС, восстановление после перезагрузки
android/build.sh       — сборка APK без Gradle за 3 с
releases/              — подписанные APK с .sha256, канал распространения
```
