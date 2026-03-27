# API Vídeos, Pastas e Cursos – Documentação

Esta documentação descreve os endpoints CRUD para gerenciamento de **pastas** (folders), **cursos** (courses), **vídeos** (videos) e suas relações N:N (**vídeo-pasta**, **vídeo-curso**).

---

## 1. Autenticação

Todas as rotas desta API exigem **autenticação** (Bearer JWT ou `X-Access-Token`).

| Header           | Descrição                          |
|------------------|------------------------------------|
| `Authorization`  | `Bearer <token>` (JWT)              |
| `X-Access-Token` | Token de API (alternativa)          |
| `Content-Type`   | `application/json` (obrigatório em POST/PUT) |

---

## 2. Base URL

- **Produção:** `https://api.posihub.com.br` (ou URL configurada)
- **Desenvolvimento:** `http://localhost:8080`

---

## 3. Pastas (Folders)

Pastas representam o caminho lógico na UI, com hierarquia via `parent_id`. Uma pasta sem `parent_id` é raiz.

### 3.1 Listar todas as pastas

```http
GET /api/folders
```

**Resposta 200:**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Matemática",
    "parent_id": null,
    "created_at": "2026-03-09T12:00:00.000+00:00"
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Álgebra",
    "parent_id": "550e8400-e29b-41d4-a716-446655440000",
    "created_at": "2026-03-09T12:00:00.000+00:00"
  }
]
```

| Campo       | Tipo   | Descrição                          |
|-------------|--------|------------------------------------|
| `id`        | UUID   | Identificador único                |
| `name`      | string | Nome da pasta                      |
| `parent_id` | UUID   | ID da pasta pai (null = raiz)      |
| `created_at`| string | Data/hora de criação (ISO 8601)    |

---

### 3.2 Listar pastas raiz

```http
GET /api/folders/roots
```

Retorna apenas pastas sem `parent_id`.

**Resposta 200:** Array de `FolderDTO` (mesmo formato acima).

---

### 3.3 Listar pastas filhas

```http
GET /api/folders/parent/{parentId}
```

| Parâmetro  | Tipo | Descrição      |
|------------|------|----------------|
| `parentId` | UUID | ID da pasta pai |

**Resposta 200:** Array de `FolderDTO`.

---

### 3.4 Buscar pasta por ID

```http
GET /api/folders/{id}
```

**Resposta 200:** Objeto `FolderDTO`.

**Resposta 404:** Pasta não encontrada.

---

### 3.5 Criar pasta

```http
POST /api/folders
Content-Type: application/json
```

**Body (CreateFolderDTO):**

```json
{
  "name": "Matemática",
  "parent_id": null
}
```

| Campo       | Tipo  | Obrigatório | Descrição                |
|-------------|-------|-------------|--------------------------|
| `name`      | string| Sim         | Nome da pasta            |
| `parent_id` | UUID  | Não         | ID da pasta pai (null = raiz) |

**Resposta 201:** Objeto `FolderDTO` criado.

**Resposta 400:** Dados inválidos (mensagem no body).

---

### 3.6 Atualizar pasta

```http
PUT /api/folders/{id}
Content-Type: application/json
```

**Body (UpdateFolderDTO):**

```json
{
  "name": "Matemática Avançada",
  "parent_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Campo       | Tipo  | Obrigatório | Descrição                |
|-------------|-------|-------------|--------------------------|
| `name`      | string| Não         | Novo nome                |
| `parent_id` | UUID  | Não         | Novo parent (null = raiz) |

**Resposta 200:** Objeto `FolderDTO` atualizado.

**Resposta 400:** Dados inválidos.

---

### 3.7 Deletar pasta

```http
DELETE /api/folders/{id}
```

**Resposta 204:** Pasta removida (cascade remove subpastas e associações).

**Resposta 404:** Pasta não encontrada.

---

## 4. Cursos (Courses)

Cursos representam o catálogo de cursos disponíveis.

### 4.1 Listar todos os cursos

```http
GET /api/courses
```

**Resposta 200:**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "name": "Medicina",
    "created_at": "2026-03-09T12:00:00.000+00:00"
  }
]
```

| Campo       | Tipo   | Descrição               |
|-------------|--------|-------------------------|
| `id`        | UUID   | Identificador único     |
| `name`      | string | Nome do curso           |
| `created_at`| string | Data/hora de criação    |

---

### 4.2 Buscar curso por ID

```http
GET /api/courses/{id}
```

**Resposta 200:** Objeto `CourseDTO`.

**Resposta 404:** Curso não encontrado.

---

### 4.3 Criar curso

```http
POST /api/courses
Content-Type: application/json
```

**Body (CreateCourseDTO):**

```json
{
  "name": "Medicina"
}
```

| Campo | Tipo   | Obrigatório | Descrição      |
|-------|--------|-------------|----------------|
| `name`| string | Sim         | Nome do curso  |

**Resposta 201:** Objeto `CourseDTO` criado.

**Resposta 400:** Dados inválidos.

---

### 4.4 Atualizar curso

```http
PUT /api/courses/{id}
Content-Type: application/json
```

**Body (UpdateCourseDTO):**

```json
{
  "name": "Medicina - 2026"
}
```

| Campo | Tipo   | Obrigatório | Descrição      |
|-------|--------|-------------|----------------|
| `name`| string | Não         | Novo nome      |

**Resposta 200:** Objeto `CourseDTO` atualizado.

**Resposta 400:** Dados inválidos.

---

### 4.5 Deletar curso

```http
DELETE /api/courses/{id}
```

**Resposta 204:** Curso removido (cascade remove associações vídeo-curso).

**Resposta 404:** Curso não encontrado.

---

## 5. Vídeos (Videos)

Vídeos representam arquivos de mídia. O campo `path` é o nome do arquivo no R2.

### 5.1 Listar todos os vídeos

```http
GET /api/videos
```

**Resposta 200:**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440020",
    "name": "Aula 1 - Funções",
    "materia": "Matemática",
    "n_aula": 1,
    "frente": "Exatas",
    "professor": "João Silva",
    "path": "matematica/aula-01.mp4",
    "created_at": "2026-03-09T12:00:00.000+00:00",
    "updated_at": "2026-03-09T12:00:00.000+00:00",
    "updated_by": "550e8400-e29b-41d4-a716-446655440099",
    "folder_ids": ["550e8400-e29b-41d4-a716-446655440000"],
    "course_ids": ["550e8400-e29b-41d4-a716-446655440010"]
  }
]
```

| Campo        | Tipo   | Descrição                          |
|--------------|--------|------------------------------------|
| `id`         | UUID   | Identificador único                |
| `name`       | string | Nome do vídeo                      |
| `materia`    | string | Matéria                            |
| `n_aula`     | int    | Número da aula                     |
| `frente`     | string | Frente (ex: Exatas)                |
| `professor`  | string | Nome do professor                 |
| `path`       | string | Nome do arquivo no R2              |
| `created_at` | string | Data/hora de criação               |
| `updated_at` | string | Data/hora da última atualização    |
| `updated_by` | UUID   | ID do usuário que atualizou        |
| `folder_ids` | UUID[] | IDs das pastas associadas          |
| `course_ids` | UUID[] | IDs dos cursos associados          |

---

### 5.2 Buscar vídeo por ID

```http
GET /api/videos/{id}
```

**Resposta 200:** Objeto `VideoDTO`.

**Resposta 404:** Vídeo não encontrado.

---

### 5.3 Criar vídeo

```http
POST /api/videos
Content-Type: application/json
```

**Body (CreateVideoDTO):**

```json
{
  "name": "Aula 1 - Funções",
  "materia": "Matemática",
  "n_aula": 1,
  "frente": "Exatas",
  "professor": "João Silva",
  "path": "matematica/aula-01.mp4",
  "updated_by": "550e8400-e29b-41d4-a716-446655440099",
  "folder_ids": ["550e8400-e29b-41d4-a716-446655440000"],
  "course_ids": ["550e8400-e29b-41d4-a716-446655440010"]
}
```

| Campo        | Tipo   | Obrigatório | Descrição                          |
|--------------|--------|-------------|------------------------------------|
| `name`       | string | Sim         | Nome do vídeo                      |
| `materia`    | string | Não         | Matéria                            |
| `n_aula`     | int    | Não         | Número da aula                     |
| `frente`     | string | Não         | Frente                             |
| `professor`  | string | Não         | Professor                          |
| `path`       | string | Sim         | Nome do arquivo no R2              |
| `updated_by` | UUID   | Não         | ID do usuário que criou/atualizou  |
| `folder_ids` | UUID[] | Não         | IDs das pastas (cria associações)  |
| `course_ids` | UUID[] | Não         | IDs dos cursos (cria associações)  |

**Resposta 201:** Objeto `VideoDTO` criado.

**Resposta 400:** Dados inválidos (ex.: pasta/curso inexistente).

---

### 5.4 Atualizar vídeo

```http
PUT /api/videos/{id}
Content-Type: application/json
```

**Body (UpdateVideoDTO):** Mesmos campos de `CreateVideoDTO`. Campos ausentes não são alterados. `folder_ids` e `course_ids` substituem as associações existentes.

**Resposta 200:** Objeto `VideoDTO` atualizado.

**Resposta 400:** Dados inválidos.

---

### 5.5 Deletar vídeo

```http
DELETE /api/videos/{id}
```

**Resposta 204:** Vídeo removido (cascade remove associações vídeo-pasta e vídeo-curso).

**Resposta 404:** Vídeo não encontrado.

---

## 6. Associação Vídeo-Pasta (Video-Folders)

Relação N:N entre vídeos e pastas.

### 6.1 Listar associações por vídeo

```http
GET /api/video-folders/video/{videoId}
```

### 6.2 Listar associações por pasta

```http
GET /api/video-folders/folder/{folderId}
```

### 6.3 Criar associação

```http
POST /api/video-folders
Content-Type: application/json
```

**Body:**
```json
{
  "video_id": "550e8400-e29b-41d4-a716-446655440020",
  "folder_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 6.4 Remover associação

```http
DELETE /api/video-folders/video/{videoId}/folder/{folderId}
```

---

## 7. Associação Vídeo-Curso (Video-Courses)

Relação N:N entre vídeos e cursos.

### 7.1 Listar associações por vídeo

```http
GET /api/video-courses/video/{videoId}
```

### 7.2 Listar associações por curso

```http
GET /api/video-courses/course/{courseId}
```

### 7.3 Criar associação

```http
POST /api/video-courses
Content-Type: application/json
```

**Body:**
```json
{
  "video_id": "550e8400-e29b-41d4-a716-446655440020",
  "course_id": "550e8400-e29b-41d4-a716-446655440010"
}
```

### 7.4 Remover associação

```http
DELETE /api/video-courses/video/{videoId}/course/{courseId}
```

---

## 8. Integração com LiveBridge — "Aula acabou"

Quando o merge do LiveBridge conclui, ele chama **`POST /api/videos`** com:

```json
{
  "name": "Aula 2025-03-09_16-33-50",
  "path": "live/matematica/2025-03-09_16-33-50.mp4",
  "materia": null,
  "n_aula": null,
  "frente": null,
  "professor": null,
  "folder_ids": [],
  "course_ids": []
}
```

O `path` segue o formato `live/{stream}/{session}.mp4`. A API deve criar o vídeo e retornar 201 com o `VideoDTO`.
