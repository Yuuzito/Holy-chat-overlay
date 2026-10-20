# Holy Chat · Overlay de chat para Kick & OBS Studio 💬🟢

Un overlay de chat para **OBS Studio** y streamers de Kick, con soporte en tiempo real de insignias nativas, emotes y cosméticos de **7TV**, temas personalizables (Oscuro, Transparente, Claro), sombras de texto y una página de configuración con chat de prueba.

Hecho con el emote de 7TV `Rlove` por **Yuuzito**.

🌐 **Enlace en vivo en GitHub Pages**: **[https://yuuzito.github.io/kick-chat-overlay/](https://yuuzito.github.io/kick-chat-overlay/)**

---

## 🚀 Cómo usar en OBS Studio

### Método 1: GitHub Pages (Directo, sin instalar nada) ⭐ Recomendado

1. Entra a **[https://yuuzito.github.io/kick-chat-overlay/](https://yuuzito.github.io/kick-chat-overlay/)** desde tu navegador.
2. Configura tu canal (ej. `rageylo`), tema, tamaño de letra, emotes y sombra de texto a tu gusto.
3. Haz clic en **"Copiar URL para OBS"**.
4. En **OBS Studio**:
   - En el panel **Fuentes**, presiona **`+`** y selecciona **Navegador** (*Browser Source*).
   - En **URL**, pega el enlace copiado (ej: `https://yuuzito.github.io/kick-chat-overlay/?channel=rageylo&overlay=true`).
   - Configura el **Ancho:** `450` y el **Alto:** `750` (o el tamaño que prefieras).
   - Marca la casilla **"Actualizar el navegador cuando la escena se active"** si deseas reiniciar la conexión en cada cambio de escena.
   - ¡Listo! Tu chat aparecerá automáticamente en pantalla en tiempo real con fondo transparente.

---

### Método 2: Servidor Local

Si prefieres ejecutarlo localmente en tu PC:
1. Haz doble clic en **`start.bat`** (o ejecuta `python server.py`).
2. Se abrirá automáticamente en `http://localhost:8000/`.
3. Pega `http://localhost:8000/?channel=rageylo&overlay=true` en tu fuente de Navegador en OBS Studio.

---

## ✨ Características

- ⚡ **7TV completo**: Soporte en tiempo real para emotes globales y del canal, cosméticos, insignias y colores de usuario.
- 🕘 **Historial al cargar**: al conectarse trae los últimos 25 mensajes del canal desde la API de Kick, así el overlay no arranca vacío. Al reconectarse vuelve a pedirlos y solo agrega los que se perdieron, sin duplicar.
- 🎖️ **Insignias nativas de Kick**: Moderador, VIP, Fundador, Suscriptores, Sub Gifters (por niveles), Verificado, Broadcaster y Staff.
- 🎨 **Temas y Estilos**:
  - **Dark**: Ideal para ventanas de vista previa y chats flotantes.
  - **Transparent**: Perfecto para OBS Studio sobre la transmisión del juego.
  - **Light**: Tema claro de alto contraste.
- ⚙️ **Página de configuración en dos paneles**:
  - A la izquierda, los ajustes: canal, emotes y cosméticos de 7TV, y sliders para tema, tamaño de letra (12–24 px), tamaño de emotes (16–64 px), tamaño de badges (12–40 px), sombra, animación y ancho del fondo de texto.
  - A la derecha, un chat de prueba con mensajes de ejemplo (no se conecta a Kick) y los emotes 7TV del canal, con los ajustes aplicados al instante. También puedes escribir tus propios mensajes.
  - Un solo botón copia la URL para OBS; el enlace no se muestra.
  - Tecla `C` para reabrir la configuración desde el overlay.

---

## ⚙️ Opciones por URL

Puedes configurar el overlay directamente mediante parámetros en la URL:

| Parámetro | Valores | Por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `channel` | texto | `rageylo` | Canal de Kick |
| `overlay` | `true` / `false` | `false` | Modo OBS directo (sin menú inicial) |
| `theme` | `dark`, `transparent`, `light` | `dark` | Estilo visual de fondo |
| `layout` | `vertical`, `horizontal`, `scatter` | `vertical` | Disposición: columna, una línea abajo o mensajes en lugares aleatorios |
| `sevenTVCosmeticsEnabled` | `true` / `false` | `true` | Insignias y colores de 7TV |
| `sevenTVEmotesEnabled` | `true` / `false` | `true` | Emotes globales y del canal |
| `size` | `10`–`60` | `14` | Tamaño del texto en píxeles (tiene prioridad sobre `textSize`) |
| `textSize` | `small`, `medium`, `large` | `medium` | Tamaño del texto (enlaces antiguos) |
| `emoteSize` | `16`–`64` | `28` | Alto de los emotes en píxeles |
| `badgeSize` | `12`–`40` | `18` | Tamaño de las badges en píxeles |
| `font` | `inter`, `roboto`, `open-sans`, `montserrat`, `poppins`, … (65 en total, ver `FONTS` en `app.js` y `EXTRA_FONTS` en `features/catalog.js`), `system`, `auto` | `inter` | Fuente del chat (Google Fonts o del sistema). `auto` usa la del estilo |
| `fontWeight` | `400`, `500`, `600`, `700`, `800` | `700` | Grosor del texto de los mensajes |
| `shadow` | `0`–`6` | `1` | Grosor de la sombra del texto; `6` es un contorno negro. Los enlaces antiguos con `textShadow` (`none`, `small`, `medium`, `large`) siguen funcionando |
| `animation` | `none`, `slide`, `fade`, `pop`, `bounce`, `zoom`, `flip`, `rotate`, `swing`, `roll` | `none` | Animación de nuevos mensajes |
| `showPinEnabled` | `true` / `false` | `false` | Mostrar banner de mensaje fijado |
| `mentionHighlightEnabled` | `true` / `false` | `true` | Resaltar en rojo los mensajes que nombran al streamer |
| `hideBots` | `true` / `false` | `false` | Oculta los mensajes de las cuentas de `bots` |
| `bots` | nombres separados por comas | `botrix, kicklet, kickbot, streamelements, nightbot, sery_bot` | Bots que oculta `hideBots` |
| `hideCommands` | `true` / `false` | `false` | Oculta los mensajes que empiezan con `!` |
| `deletedMessages` | `hide`, `strike`, `notice` | `notice` | Mensajes borrados: se ocultan, se tachan o se reemplazan por `<mensaje borrado>` |
| `fade` | `0`, `1`, `3`, `5`, `10`, `15`, `30`, `60`, `120`, `300` | `0` | Segundos hasta que un mensaje desaparece (`0` = nunca) |
| `design` | `chatterino`, `default`, `aurora`, `bubbles`, `cake`, `carbon`, `glass`, `minimal`, `platform-accent`, `side`, `streamline`, `transparent`, `white`, `hacker`, `neon`, `neoncards`, `pastelpop`, `pixelquest`, `rounded`, `sky`, `sunset`, `windowglass`, `whatschat`, `retro`, `velvet`, `winxp`, `frutigeraero`, `liquidglass` | `chatterino` | Estilo de cada mensaje (tarjetas, burbujas, ventana, terminal…). Ver `features/catalog.js` |
| `direction` | `bottom`, `top` | `bottom` | Dónde aparecen los mensajes nuevos en la columna |
| `background` | `#rrggbbaa` | sin fondo | Color de fondo del chat con opacidad; reemplaza el del tema |
| `ignoredUsers` | nombres separados por comas | vacío | Usuarios cuyos mensajes, donaciones y canjes no se muestran |
| `sound` | `0`–`100` | `0` | Volumen del sonido de mensaje nuevo (`0` = sin sonido) |
| `soundType` | `default`, `chime`, `bell`, `pop`, `digital`, `soft`, `sparkle`, `pulse`, `arcade`, `knock` | `default` | Sonido de mensaje nuevo (generado en el navegador, sin archivos de audio) |
| `donations` | `true` / `false` | `true` | Muestra cuando alguien envía Kicks |
| `rewards` | `true` / `false` | `false` | Muestra los canjes de puntos del canal |
| `platformIcon` | `true` / `false` | `false` | Icono de Kick antes de las badges |
| `timestamps` | `true` / `false` | `false` | Hora del mensaje (HH:MM) antes del nombre |
