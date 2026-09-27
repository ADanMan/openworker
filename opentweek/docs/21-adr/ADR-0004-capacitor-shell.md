# ADR-0004: Android-оболочка на Capacitor

Дата: 27 сентября 2026 года
Статус: Superseded by ADR-0005

## Контекст

Нужен APK из существующего веб-приложения с локальными уведомлениями.

## Рассмотренные варианты

- Capacitor 8 + `@capacitor/local-notifications`, `app`, `filesystem`, `share` — готовые плагины, MIT / сборка через Gradle и Android Gradle Plugin из Google Maven;
- TWA (Trusted Web Activity) — минимальный APK / нужен хостинг и Digital Asset Links, нет нативных будильников.

## Решение

Capacitor 8, сборка APK в GitHub Actions.

## Последствия

Отрицательные: сборка оказалась невозможной ни в одной доступной среде. GitHub Actions на аккаунте не выделяют раннер (`runner_id: 0`, задачи падают за 1–2 с без логов). В среде разработки `dl.google.com` и `maven.google.com` закрыты политикой сети, а без них нет Android Gradle Plugin и AndroidX.
Что станет сигналом пересмотреть решение: сработало — заменено ADR-0005.
