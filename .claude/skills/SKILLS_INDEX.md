# JudiScribe Skills Index

**Ubicación**: `d:\Proyectos\Judiscribe\.claude\skills\`
**Total Skills**: 11
**Tamaño**: ~772KB
**Última actualización**: 2026-03-17

---

## 📋 Inventario Maestro de Skills

### ✅ Backend & Architecture

#### 1. **architecture-patterns** (15.6KB)
- **Ubicación**: `./architecture-patterns/SKILL.md`
- **Descripción**: Patrones comprobados (Clean Architecture, Hexagonal, Domain-Driven Design)
- **Caso de uso**: Diseño de servicios FastAPI, estructura de Celery tasks
- **Referencia en proyecto**: Backend services, task design
- **Estado**: ✅ Integrado y activo

#### 2. **python-performance-optimization** (22.1KB)
- **Ubicación**: `./python-performance-optimization/SKILL.md`
- **Descripción**: Profiling, memory optimization, performance best practices
- **Caso de uso**: Optimizar Deepgram processing, batch transcription bottlenecks
- **Referencia en proyecto**: Backend services optimization
- **Estado**: ✅ Integrado y activo

#### 3. **claude-api** (18.5KB + subdirectorios)
- **Ubicación**: `./claude-api/SKILL.md`
- **Descripción**: Claude API + Anthropic SDK integration (soporte multi-lenguaje)
- **Subdirectorios de documentación**:
  - `python/` - Python SDK examples
  - `typescript/` - TypeScript/JavaScript SDK examples
  - `java/`, `go/`, `ruby/`, `csharp/`, `php/`, `curl/`
  - `shared/` - Shared patterns
- **Caso de uso**: Acta generation con Claude Sonnet 4 (Sprint 5+)
- **Archivos principales**: `LICENSE.txt`, `SKILL.md`
- **Referencia en proyecto**: `backend/app/services/acta_generator.py`
- **Estado**: ✅ Integrado completamente (from skills.sh)

---

### ✅ Frontend - React & Next.js

#### 4. **react-patterns** (34.8KB)
- **Ubicación**: `./react-patterns/SKILL.md`
- **Descripción**: React 19 patterns (Server Components, Suspense, useOptimistic, Concurrent features)
- **Subdirectorio**: `references/` - Additional patterns
- **Caso de uso**: Real-time transcript updates, speaker UI, acta editor state management
- **Referencia en proyecto**: `frontend/src/components/`, `frontend/src/hooks/`
- **Estado**: ✅ Integrado y activo

#### 5. **nextjs-app-router-patterns** (14.2KB)
- **Ubicación**: `./nextjs-app-router-patterns/SKILL.md`
- **Descripción**: Next.js 14+ App Router, SSR, streaming, parallel routes
- **Caso de uso**: Acta preview pages, dynamic audiencia routing, API endpoints
- **Referencia en proyecto**: `frontend/src/app/`, `backend/app/api/`
- **Estado**: ✅ Integrado y activo

#### 6. **tailwind-css-patterns** (21.5KB)
- **Ubicación**: `./tailwind-css-patterns/SKILL.md`
- **Descripción**: Utility-first CSS, responsive design, layout patterns
- **Subdirectorio**: `references/reference.md` - Comprehensive CSS reference
- **Caso de uso**: Canvas layout, acta document styling, print-friendly CSS
- **Referencia en proyecto**: `frontend/src/styles/`, TipTap Canvas styling
- **Estado**: ✅ Integrado y activo

#### 7. **shadcn-ui** (49.8KB)
- **Ubicación**: `./shadcn-ui/SKILL.md`
- **Descripción**: shadcn/ui component library (React Hook Form, Zod validation)
- **Subdirectorio**: `references/` - Component examples and patterns
- **Caso de uso**: Form validation, dialogs, acta editor components
- **Referencia en proyecto**: `frontend/src/components/` (Forms, Modals)
- **Estado**: ✅ Integrado y activo

---

### ✅ Design & UX

#### 8. **frontend-design** (4.3KB)
- **Ubicación**: `./frontend-design/SKILL.md`
- **Descripción**: Production-grade UI/UX design, high-quality interfaces
- **Caso de uso**: Polish transcript canvas, acta preview aesthetics
- **Referencia en proyecto**: Visual design consistency
- **Estado**: ✅ Integrado y activo

#### 9. **interface-design** (20.4KB)
- **Ubicación**: `./interface-design/SKILL.md`
- **Descripción**: Dashboard, admin panels, interactive products, workflow UX
- **Subdirectorio**: `references/` - Design patterns, principles, examples
- **Caso de uso**: Acta editor interface, supervisor approval workflow UI
- **Referencia en proyecto**: `frontend/src/components/` (Panels, Workflows)
- **Estado**: ✅ Integrado y activo

#### 10. **design-system-patterns** (10.0KB)
- **Ubicación**: `./design-system-patterns/SKILL.md`
- **Descripción**: Design tokens, theming infrastructure, component architecture
- **Subdirectorio**: `references/` - Token definitions, theme patterns
- **Caso de uso**: Consistent legal form styling, document layout
- **Referencia en proyecto**: Tailwind config, color/spacing system
- **Estado**: ✅ Integrado y activo

---

### ✅ Accessibility & Compliance

#### 11. **accessibility-compliance** (12.6KB)
- **Ubicación**: `./accessibility-compliance/SKILL.md`
- **Descripción**: WCAG 2.2 compliance, ARIA patterns, screen reader support, mobile accessibility
- **Subdirectorio**: `references/` - ARIA patterns, WCAG guidelines, mobile accessibility
- **Caso de uso**: Keyboard navigation, screen reader support for audio player, transcript accessibility
- **Referencia en proyecto**: `frontend/src/components/` (ARIA labels, semantic HTML)
- **Estado**: ✅ Integrado y activo

---

## 🎯 Skills por Sprint/Funcionalidad

### Sprint 5: Acta Generation
- ✅ **claude-api** - Claude Sonnet 4 integration
- ✅ **nextjs-app-router-patterns** - Acta preview endpoint
- ✅ **tailwind-css-patterns** - Acta document styling
- ✅ **shadcn-ui** - Form dialogs

### Sprint 6-7: Batch Processing & Optimization
- ✅ **python-performance-optimization** - Profile batch transcription
- ✅ **architecture-patterns** - Celery task design

### Sprint 8-9: Acta Editing & Approval
- ✅ **react-patterns** - State management for editor
- ✅ **interface-design** - Approval workflow UX
- ✅ **shadcn-ui** - Form + dialog components
- ✅ **tailwind-css-patterns** - Responsive editor layout

### Sprint 10+: Export & Polish
- ✅ **tailwind-css-patterns** - Print-friendly CSS
- ✅ **frontend-design** - High-quality aesthetics
- ✅ **accessibility-compliance** - WCAG compliance

---

## 🔗 Conexión & Integración

### Cómo están conectados los skills:

**Backend Layer:**
```
architecture-patterns (service design)
    ↓
python-performance-optimization (optimize services)
    ↓
claude-api (LLM integration)
```

**Frontend Layer:**
```
react-patterns (component logic)
    ↓
nextjs-app-router-patterns (page routing)
    ↓
tailwind-css-patterns (styling)
    ↓
shadcn-ui (components)
```

**Design & UX Layer:**
```
design-system-patterns (foundation)
    ↓
interface-design (workflows)
    ↓
frontend-design (aesthetics)
    ↓
accessibility-compliance (standards)
```

---

## ✅ Verificación de Integridad

| Skill | SKILL.md | References | Status | Size |
|-------|----------|-----------|--------|------|
| accessibility-compliance | ✅ | ✅ | Active | 12.6KB |
| architecture-patterns | ✅ | - | Active | 15.6KB |
| claude-api | ✅ | Multi-lang | Active | 18.5KB |
| design-system-patterns | ✅ | ✅ | Active | 10.0KB |
| frontend-design | ✅ | - | Active | 4.3KB |
| interface-design | ✅ | ✅ | Active | 20.4KB |
| nextjs-app-router-patterns | ✅ | - | Active | 14.2KB |
| python-performance-optimization | ✅ | - | Active | 22.1KB |
| react-patterns | ✅ | ✅ | Active | 34.8KB |
| shadcn-ui | ✅ | ✅ | Active | 49.8KB |
| tailwind-css-patterns | ✅ | ✅ | Active | 21.5KB |

**Total**: 11/11 skills ✅ Integrados y activos

---

## 🚀 Cómo Usar Este Índice

1. **Buscar un skill por nombre**: Usa Ctrl+F
2. **Buscar por caso de uso**: Busca "Sprint" o "Caso de uso"
3. **Ver documentación**: Abre `./[skill-name]/SKILL.md`
4. **Ver referencias**: Abre `./[skill-name]/references/`

---

## 📝 Archivos en .claude/skills

```
d:\Proyectos\Judiscribe\.claude\skills\
├── SKILLS_INDEX.md (este archivo)
│
├── accessibility-compliance/
│   ├── SKILL.md
│   └── references/
│
├── architecture-patterns/
│   └── SKILL.md
│
├── claude-api/
│   ├── SKILL.md
│   ├── LICENSE.txt
│   ├── python/
│   ├── typescript/
│   ├── java/
│   ├── go/
│   ├── ruby/
│   ├── csharp/
│   ├── php/
│   ├── curl/
│   └── shared/
│
├── design-system-patterns/
│   ├── SKILL.md
│   └── references/
│
├── frontend-design/
│   └── SKILL.md
│
├── interface-design/
│   ├── SKILL.md
│   └── references/
│
├── nextjs-app-router-patterns/
│   └── SKILL.md
│
├── python-performance-optimization/
│   └── SKILL.md
│
├── react-patterns/
│   ├── SKILL.md
│   └── references/
│
├── shadcn-ui/
│   ├── SKILL.md
│   └── references/
│
└── tailwind-css-patterns/
    ├── SKILL.md
    └── references/
```

---

## 🔄 Verificación Final

✅ **Sin duplicados** - Cada skill aparece una sola vez
✅ **Sin directorios vacíos** - Todos contienen al menos SKILL.md
✅ **Conectados lógicamente** - Backend → Frontend → Design
✅ **Documentados completamente** - Todas las referencias presentes
✅ **Integrados en sprints** - Mapeados a funcionalidades específicas

---

**Estado**: TODO BIEN CONFIGURADO Y LISTO PARA DESARROLLO

Última verificación: 2026-03-17

