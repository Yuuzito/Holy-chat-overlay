# Joseo Chat Overlay para Kick & OBS Studio 💬🟢

Un overlay de chat para **OBS Studio** y streamers de Kick, con soporte en tiempo real de insignias nativas, emotes y cosméticos de **7TV**, temas personalizables (Oscuro, Transparente, Claro), sombras de texto y menú interactivo de configuración.

Hecho con el emote de 7TV `Rlove` por **Yuuzito**.

🌐 **Enlace en vivo en GitHub Pages**: **[https://yuuzito.github.io/kick-chat-overlay/](https://yuuzito.github.io/kick-chat-overlay/)**

---

## 🚀 Cómo usar en OBS Studio

### Método 1: GitHub Pages (Directo, sin instalar nada) ⭐ Recomendado

1. Entra a **[https://yuuzito.github.io/kick-chat-overlay/](https://yuuzito.github.io/kick-chat-overlay/)** desde tu navegador.
2. Configura tu canal (ej. `rageylo`), tema, tamaño de letra, emotes y sombra de texto a tu gusto.
3. Haz clic en **"📋 Copiar URL de Overlay para OBS"**.
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
- 🎖️ **Insignias nativas de Kick**: Moderador, VIP, Fundador, Suscriptores, Sub Gifters (por niveles), Verificado, Broadcaster y Staff.
- 🎨 **Temas y Estilos**:
  - **Dark**: Ideal para ventanas de vista previa y chats flotantes.
  - **Transparent**: Perfecto para OBS Studio sobre la transmisión del juego.
  - **Light**: Tema claro de alto contraste.
- ⚙️ **Menú de configuración interactivo**:
  - Canal personalizable.
  - Activar / desactivar cosméticos y emotes de 7TV.
  - Selector de tamaño de letra (Small, Medium, Large, Extra Large).
  - Sombras de texto (Ninguna, Small, Medium, Large) y fondos de texto.
  - Animaciones de entrada de mensajes (Ninguna, Slide, Fade).
  - Mensaje de prueba instantáneo para previsualizar estilos antes de transmitir.
  - Botón de engranaje flotante para reabrir y modificar la configuración en cualquier momento.

---

## ⚙️ Opciones por URL

Puedes configurar el overlay directamente mediante parámetros en la URL:

| Parámetro | Valores | Por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `channel` | texto | `rageylo` | Canal de Kick |
| `overlay` | `true` / `false` | `false` | Modo OBS directo (sin menú inicial) |
| `theme` | `dark`, `transparent`, `light` | `dark` | Estilo visual de fondo |
| `sevenTVCosmeticsEnabled` | `true` / `false` | `true` | Insignias y colores de 7TV |
| `sevenTVEmotesEnabled` | `true` / `false` | `true` | Emotes globales y del canal |
| `textSize` | `small`, `medium`, `large`, `xlarge` | `medium` | Tamaño del texto |
| `textShadow` | `none`, `small`, `medium`, `large` | `small` | Sombra para legibilidad |
| `animation` | `none`, `slide`, `fade` | `none` | Animación de nuevos mensajes |
| `showPinEnabled` | `true` / `false` | `false` | Mostrar banner de mensaje fijado |
