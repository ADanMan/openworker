# ADR-0005: Своя WebView-оболочка, сборка без Gradle

Дата: 27 сентября 2026 года
Статус: Accepted

## Контекст

ADR-0004 не собирается: нет доступа к Google Maven, GitHub Actions не работают. Архив Ubuntu 24.04 доступен и содержит `aapt`, `dalvik-exchange` (dx), `zipalign`, `apksigner` и `android-sdk-platform-23` (`android.jar` API 23). Нужных нативных функций немного: будильники, уведомления, «Поделиться», «Сохранить как», выбор файла, «назад», HTTP-запрос без CORS.

## Рассмотренные варианты

- Capacitor — см. ADR-0004 / не собирается;
- Своя оболочка без AndroidX: `Activity` + `WebView` + `@JavascriptInterface`, около 530 строк Java — собирается `aapt`, `javac`, `dx`, `apksigner` за 3 с, APK 348 КБ / нативный код поддерживается вручную, API новее 23 вызываются через рефлексию;
- TWA — нужен публичный хостинг, нет нативных будильников.

## Решение

Своя оболочка в `android/` (`MainActivity`, `NativeBridge`, `Reminders`, `ReminderReceiver`, `BootReceiver`). Веб-бандл отдаётся из `assets/www` через `shouldInterceptRequest` на origin `https://app.opentweek.local`. Сборка: `android/build.sh`. `minSdk 24`, `targetSdk 34`.

## Последствия

Положительные: сборка воспроизводима на любой Ubuntu 24.04 без Android Studio; APK 348 КБ, из них 111 КБ шрифты; нет сторонних нативных зависимостей.
Отрицательные: `targetSdk 34`, а не 35: на 35 включается принудительный edge-to-edge, который оболочка не обрабатывает. Для Google Play этого уже недостаточно. Ошибки в рефлексии (`NotificationChannel`, `setChannelId`, `areNotificationsEnabled`) не ловятся компилятором.
Что станет сигналом пересмотреть решение: публикация в Google Play (нужен `targetSdk` 35+), или больше 3 новых нативных функций за релиз. Тогда переход на Gradle с `compileSdk` 35+ в среде с доступом к Google Maven.
