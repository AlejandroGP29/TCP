# Plataforma de Simulación TCP

Bienvenido a la plataforma web de simulación TCP. Este proyecto permite visualizar y gestionar los estados de los nodos TCP, realizar transiciones entre estados y ajustar parámetros en tiempo real.

## Descarga del Código

Clona el repositorio usando el siguiente comando en tu terminal:

```sh
git clone https://github.com/AlejandroGP29/TCP.git
cd TCP
```

## Instalación de Dependencias

Ejecuta el siguiente comando para instalar las dependencias necesarias:

```sh
npm install
```

Las dependencias principales incluyen:

- **express** - Framework de Node.js para el servidor web.
- **bcryptjs** - Librería para el hash de contraseñas en la autenticación de usuarios.
- **jsonwebtoken** - Librería para la generación y verificación de tokens JWT.
- **dotenv** - Gestión de variables de entorno.
- **sqlite3** - Base de datos para almacenar configuraciones y el historial de mensajes.

## Configuración del Entorno

Crea un archivo **.env** en la raíz del proyecto y define las variables de entorno requeridas. Ejemplo de configuración básica:

```ini
SECRET_KEY=tu_clave_secreta
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Ejecución del Proyecto

Para iniciar el servidor, ejecuta:

```sh
npm start
```

El servidor correrá en **http://localhost:3000** por defecto.

## Ejecución en Modo Desarrollo

Para facilitar el desarrollo, el proyecto incluye **nodemon**, que reinicia automáticamente el servidor cuando se detectan cambios. Para ejecutar en modo desarrollo, usa:

```sh
npm run dev
```

## Uso de la Plataforma

Una vez iniciado el servidor, accede a la plataforma mediante tu navegador. Los usuarios pueden:

- Visualizar los estados de los nodos TCP y el historial de mensajes.
- Realizar transiciones entre estados TCP.
- Ajustar parámetros de simulación en tiempo real.

## Estructura de Archivos

El proyecto sigue la siguiente estructura:

```
📂 TCP/
 ├── 📜 index.js        # Configuración del servidor y rutas de API
 ├── 📜 tcpNode.js      # Lógica de simulación TCP
 ├── 📜 db.js           # Configuración de la base de datos
 📂 public/
   ├── 📜 app.js          # Scripts de frontend
   ├── 📜 style.css       # Estilos de la interfaz
   ├── 📜 index.html      # Estructura de la interfaz
```
---

**Autor:** [AlejandroGP29](https://github.com/AlejandroGP29)
