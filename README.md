<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/images/cover-light.svg" />
    <img src="docs/images/cover-dark.svg" alt="Termlume — терминал, файлы и мониторинг" width="100%" />
  </picture>

  <p><strong>SSH-клиент для Windows и Linux, в котором всё рядом.</strong><br />
  Сессии, файлы и состояние сервера — в одной рабочей области.</p>

  <p>
    <a href="https://github.com/Termlume/Termlume/releases/latest"><img src="https://img.shields.io/github/v/release/Termlume/Termlume?style=flat-square&amp;label=release&amp;color=7354b5" alt="Последняя версия" /></a>
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=flat-square" alt="Windows 10 и 11" />
    <img src="https://img.shields.io/badge/Linux-x86__64-E95420?style=flat-square" alt="Linux x86_64" />
    <img src="https://img.shields.io/badge/status-beta-e6b450?style=flat-square" alt="Бета-версия" />
  </p>

  <p>
    <a href="https://github.com/Termlume/Termlume/releases/latest"><strong>Windows x64</strong></a>
    &nbsp; · &nbsp; <a href="https://github.com/Termlume/Termlume/releases/download/v0.2.3/Termlume-0.2.3-linux-amd64.deb"><strong>Linux · DEB</strong></a>
    &nbsp; · &nbsp; <a href="https://github.com/Termlume/Termlume/releases/download/v0.2.3/Termlume-0.2.3-linux-x86_64.AppImage">AppImage</a>
    &nbsp; · &nbsp; <a href="CHANGELOG.md">Что нового</a>
    &nbsp; · &nbsp; <a href="https://github.com/Termlume/Termlume/issues/new?template=bug_report.yml">Сообщить об ошибке</a>
    &nbsp; · &nbsp; <a href="#coffee">На кофе :)</a>
  </p>
</div>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/overview-light.png" />
  <img src="docs/images/overview-dark.png" alt="Termlume: SSH-сессия, файловый браузер и компактный мониторинг сервера" width="100%" />
</picture>

<p align="center"><sub>Реальный интерфейс 0.2.1b. На всех снимках — демонстрационные подключения и файлы.</sub></p>

## Всё для работы с сервером

| Сессии и подключения | Работа с файлами |
| :--- | :--- |
| SSH, Telnet и локальный терминал. В Windows — также WSL, PowerShell и cmd. Вкладки и изменяемые сплиты. | Вкладки SFTP и FTP/FTPS. Файловый браузер рядом с терминалом. |
| Избранное, теги с поиском по `#prod`, сворачиваемые группы и их перестановка. | Перенос файлов и папок, включая SFTP → Nautilus и рабочий стол в Linux. Открытие в редакторе и загрузка сохранённых изменений на сервер. |
| Макросы по `/` и переназначение горячих клавиш. | Права, владелец и группа, контекстное меню, сортировка и адаптивные столбцы. |

**Состояние сервера перед глазами.** CPU, RAM, температуры, диски, трафик, пользователи и TCP-соединения Linux по SSH и в WSL. Боковая панель или компактная строка под терминалом; подробности — по наведению. Установка агента на сервер не требуется.

**Настройки под вашу работу.** Общие учётные данные для нескольких серверов, индивидуальный порядок метрик, конструктор подсветки с готовыми правилами и переход файлового браузера вслед за терминалом.

**Привычный внешний вид.** Catppuccin, VS Code, Tokyo Night и One Dark. Светлые и тёмные темы применяются и к интерфейсу, и к терминалу.

**Графика и журналы.** X11 forwarding открывает графические приложения SSH-сервера в окнах Windows. Журналы сеансов сохраняют вывод локально; запись включается вручную или в настройках.

## Посмотреть ближе

<details>
<summary><strong>Файловый клиент — локальная и удалённая стороны</strong></summary>

Отдельная вкладка для передачи файлов. Права, владелец и группа отображаются в таблице; действия доступны по правому клику.

![Двухпанельная вкладка SFTP с демонстрационными файлами](docs/images/file-client.png)

</details>

<details>
<summary><strong>Библиотека команд — частые команды под рукой</strong></summary>

Введите `/` в начале команды, найдите нужную запись и выберите её. Команда сначала вставляется в терминал; повторный Enter запускает её. В библиотеке доступны поиск, категории, готовые примеры и привязка к подключениям.

<img src="docs/images/macros.png" alt="Список макросов терминала: журналы, службы и свободное место" width="560" />

</details>

<details>
<summary><strong>Светлая тема</strong></summary>

![Рабочая область Termlume в теме VS Code Light Modern](docs/images/overview-light.png)

</details>

## Установка и обновления

| Платформа | Установка | Обновления |
| :--- | :--- | :--- |
| **Windows 10/11 x64** | Установщик `Termlume-Setup-…-x64.exe` из [последнего выпуска](https://github.com/Termlume/Termlume/releases/latest). | Проверка каждый час, загрузка и установка из приложения. |
| **Linux x86_64** | [DEB 0.2.3](https://github.com/Termlume/Termlume/releases/download/v0.2.3/Termlume-0.2.3-linux-amd64.deb). Проверен в Ubuntu 24.04 с GNOME/Wayland. | Проверка каждый час, загрузка и установка из приложения. Для DEB потребуется системное подтверждение прав администратора. |

Для Linux установите скачанный пакет с зависимостями:

```sh
sudo apt install ./Termlume-0.2.3-linux-amd64.deb
```

[Подробнее о Linux](docs/LINUX.md): SSH-ключи, хранилище паролей и сборка из исходников. В Debian 13 проверены зависимости и загрузка файлового компонента; полная проверка интерфейса ещё не выполнена. AppImage доступен как экспериментальный вариант и отдельно пока не проверен.

В Windows **основной канал** — публичная бета, **предварительный** — альфа-сборки с новыми возможностями. Канал выбирается в настройках; при переключении приложение не понижает установленную версию.

<details>
<summary>О текущей бете</summary>

Установщик Windows пока без цифровой подписи. Продолжение передачи после обрыва и объединение существующих папок пока не поддерживаются. Telnet сам по себе не предоставляет файлового канала.

</details>

## Ваши данные остаются у вас

Подключения и настройки хранятся локально. Пароли защищены средствами Windows или системного хранилища секретов Linux, например GNOME Keyring. Для использования Termlume не нужна учётная запись в облачном сервисе.

Обновление приложения сохраняет подключения, пароли и настройки. Для резервной копии и переноса на другой компьютер есть зашифрованный экспорт и импорт в настройках.

<details>
<summary>Где хранятся данные</summary>

- Windows: `%APPDATA%\Terminal` — каталог сохранён для совместимости с первыми версиями.
- Linux: `~/.config/Termlume/`.

Для переноса между системами используйте зашифрованный экспорт и импорт. Приватные SSH-ключи не копируются в архив: перенесите их отдельно и обновите пути.

</details>

## Исходный код

[`main`](https://github.com/Termlume/Termlume/tree/main) содержит исходники опубликованной Windows-версии. Исходники Linux-порта 0.2.3 доступны в ветке [`linux`](https://github.com/Termlume/Termlume/tree/linux) и [отдельным архивом в релизе](https://github.com/Termlume/Termlume/releases/download/v0.2.3/Termlume-0.2.3-linux-source.tar.gz). Тег `v0.2.3` сохранён без изменений.

<a id="coffee"></a>

## На кофе :)

Если Termlume помогает в работе, можно поддержать его развитие.

<details>
<summary><strong>Показать адреса для поддержки</strong></summary>

| Сеть | Адрес |
| :--- | :--- |
| Ethereum / ERC20 | `0x9a3C0E1bbfe4012CB74B26bb87885F4A3273432D` |
| TON | `UQBlqyl-R3_2G41y19kQX-z6i6ouWQwBq5SQ-OF0ci9t_hLG` |
| Bitcoin | `bc1q7d27puu22r8q3vnmdsqfuqh65qtflezysqhxet` |

</details>

---

<sub>Права на Termlume сохраняются за авторами; открытая лицензия на исходники пока не объявлена. Лицензии сторонних компонентов поставляются с приложением в `THIRD_PARTY_NOTICES.txt` и каталоге `licenses`.</sub>
