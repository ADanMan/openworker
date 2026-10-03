# ADR-0010: Голосовой ввод без App Actions

Дата: 27 сентября 2026 года
Статус: Superseded для 1.2.0 — см. ADR-0011-local-journal-voice.md. Ниже сохранён исторический контекст версии 1.1.

## Контекст

Нужно добавлять задачи голосом, в идеале фразой «Окей Google, добавь задачу в opentweek». Штатный путь интеграции с Google Assistant — App Actions: возможности объявляются в `shortcuts.xml`, и Google регистрирует их, только когда приложение загружено в Google Play Console. opentweek распространяется APK-файлом из репозитория (не-цель PRD: публикация в Google Play).

## Рассмотренные варианты

- App Actions (`actions.intent.CREATE_THING` и подобные) — настоящая фраза «Окей Google, …» / нужна публикация в Play, а `shortcuts.xml` не собирается `aapt` для API 23;
- системное распознавание речи (`RecognizerIntent.ACTION_RECOGNIZE_SPEECH`, сервис Google) по кнопке в приложении и по ярлыку на иконке + свой разбор фразы — работает в APK из репозитория и без разрешения `RECORD_AUDIO` / фраза «Окей Google» сама по себе задачу не создаёт;
- Web Speech API в браузере — тот же разбор для веб-версии / в Android WebView не поддерживается.

## Решение

Кнопка микрофона и клавиша `V` открывают системный диалог распознавания (Android) или Web Speech API (браузер). Фраза разбирается `src/lib/quickadd.ts` в заголовок, день, время напоминания и повтор. Те же точки входа принимают текст из «Поделиться» (`ACTION_SEND`, PWA `share_target`) и два ярлыка на иконке: «Голосовая задача» и «Новая задача» (`ShortcutManager` через рефлексию). Фильтр `com.google.android.gm.action.AUTO_SEND` («заметка себе») добавлен экспериментально: его работа в текущем Assistant или Gemini не проверена.

## Последствия

Положительные: голосовая задача в два касания (ярлык → фраза) без публикации в Play; одна логика разбора для голоса, «Поделиться» и веб-версии.
Отрицательные: «Окей Google, открой opentweek» только открывает приложение; сама команда в Assistant задачу не создаёт. Разбор фраз эвристический, с набором правил для ru и en.
Что станет сигналом пересмотреть решение: публикация в Google Play (тогда App Actions с `CREATE_THING`), или появление у Gemini публичного API расширений для сторонних Android-приложений.

Официальное описание App Actions и регистрации через Play Console:  
https://developer.android.com/develop/devices/assistant/overview

`RecognizerIntent`:  
https://developer.android.com/reference/android/speech/RecognizerIntent
