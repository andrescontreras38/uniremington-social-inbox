import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, ApiError, queryString } from '../api/client';
import { Notice } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { ProgramTemplate, TemplateListResponse } from '../types';

/**
 * Plantillas de programa.
 *
 * Cada tarjeta es el dato oficial de un programa. Lo que la pantalla tiene que
 * dejar claro de un vistazo no es cuantas plantillas hay, sino cuales sirven
 * hoy para responder por costos: una sin valor o con vigencia vencida no se
 * usa, y esa es la diferencia entre resolverle el precio a un aspirante y
 * mandarlo a admisiones.
 */

const FACULTIES = [
  'Ciencias de la Salud',
  'Ciencias Empresariales',
  'Ciencias Contables',
  'Ciencias Juridicas y Politicas',
  'Ingenierias',
  'Diseno',
  'Medicina Veterinaria',
];

const LEVELS = ['PREGRADO', 'ESPECIALIZACION', 'MAESTRIA', 'TECNOLOGIA'] as const;
const MODALITIES = ['PRESENCIAL', 'DISTANCIA', 'VIRTUAL', 'HIBRIDA', 'COMBINADA'] as const;

const LEVEL_LABEL: Record<string, string> = {
  PREGRADO: 'Pregrado',
  ESPECIALIZACION: 'Especializacion',
  MAESTRIA: 'Maestria',
  TECNOLOGIA: 'Tecnologia',
};

const MODALITY_LABEL: Record<string, string> = {
  PRESENCIAL: 'Presencial',
  DISTANCIA: 'A distancia',
  VIRTUAL: 'Virtual',
  HIBRIDA: 'Hibrida',
  COMBINADA: 'Combinada',
};

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const EMPTY: TemplateDraft = {
  name: '',
  faculty: FACULTIES[1] ?? '',
  level: 'PREGRADO',
  modality: 'PRESENCIAL',
  campuses: 'NACIONAL',
  semesterValue: '',
  enrollmentFee: '',
  otherFeesNote: '',
  discountNote: '',
  durationSemesters: '',
  credits: '',
  requirements: '',
  degreeAwarded: '',
  sniesCode: '',
  description: '',
  professionalProfile: '',
  curriculum: '',
  scheduleNote: '',
  admissionProcess: '',
  homologationNote: '',
  faq: '',
  officialUrl: '',
  validFrom: '',
  validUntil: '',
  costIsPublic: true,
  notes: '',
  isActive: true,
};

interface TemplateDraft {
  name: string;
  faculty: string;
  level: string;
  modality: string;
  campuses: string;
  semesterValue: string;
  enrollmentFee: string;
  durationSemesters: string;
  credits: string;
  otherFeesNote: string;
  discountNote: string;
  requirements: string;
  degreeAwarded: string;
  sniesCode: string;
  description: string;
  professionalProfile: string;
  curriculum: string;
  scheduleNote: string;
  admissionProcess: string;
  homologationNote: string;
  faq: string;
  officialUrl: string;
  validFrom: string;
  validUntil: string;
  costIsPublic: boolean;
  notes: string;
  isActive: boolean;
}

function toDraft(template: ProgramTemplate): TemplateDraft {
  const date = (value: string | null) => (value ? value.slice(0, 10) : '');
  const num = (value: number | null) => (value === null ? '' : String(value));

  return {
    name: template.name,
    faculty: template.faculty,
    level: template.level,
    modality: template.modality,
    campuses: template.campuses,
    semesterValue: num(template.semesterValue),
    enrollmentFee: num(template.enrollmentFee),
    durationSemesters: num(template.durationSemesters),
    credits: num(template.credits),
    otherFeesNote: template.otherFeesNote ?? '',
    discountNote: template.discountNote ?? '',
    requirements: template.requirements ?? '',
    degreeAwarded: template.degreeAwarded ?? '',
    sniesCode: template.sniesCode ?? '',
    description: template.description ?? '',
    professionalProfile: template.professionalProfile ?? '',
    curriculum: template.curriculum ?? '',
    scheduleNote: template.scheduleNote ?? '',
    admissionProcess: template.admissionProcess ?? '',
    homologationNote: template.homologationNote ?? '',
    faq: template.faq ?? '',
    officialUrl: template.officialUrl ?? '',
    validFrom: date(template.validFrom),
    validUntil: date(template.validUntil),
    costIsPublic: template.costIsPublic,
    notes: template.notes ?? '',
    isActive: template.isActive,
  };
}

/** Convierte el formulario al cuerpo que espera la API. */
function toPayload(draft: TemplateDraft) {
  const num = (value: string) => (value.trim() === '' ? null : Number(value));

  return {
    name: draft.name.trim(),
    faculty: draft.faculty,
    level: draft.level,
    modality: draft.modality,
    campuses: draft.campuses.trim() || 'NACIONAL',
    semesterValue: num(draft.semesterValue),
    enrollmentFee: num(draft.enrollmentFee),
    durationSemesters: num(draft.durationSemesters),
    credits: num(draft.credits),
    otherFeesNote: draft.otherFeesNote.trim() || null,
    discountNote: draft.discountNote.trim() || null,
    requirements: draft.requirements.trim() || null,
    degreeAwarded: draft.degreeAwarded.trim() || null,
    sniesCode: draft.sniesCode.trim() || null,
    description: draft.description.trim() || null,
    professionalProfile: draft.professionalProfile.trim() || null,
    curriculum: draft.curriculum.trim() || null,
    scheduleNote: draft.scheduleNote.trim() || null,
    admissionProcess: draft.admissionProcess.trim() || null,
    homologationNote: draft.homologationNote.trim() || null,
    faq: draft.faq.trim() || null,
    officialUrl: draft.officialUrl.trim() || null,
    validFrom: draft.validFrom || null,
    validUntil: draft.validUntil || null,
    costIsPublic: draft.costIsPublic,
    notes: draft.notes.trim() || null,
    isActive: draft.isActive,
  };
}

export function TemplatesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = can('templates:write');

  const [faculty, setFaculty] = useState('');
  const [estado, setEstado] = useState('todas');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: TemplateDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['templates', faculty, estado, search],
    queryFn: () =>
      apiFetch<TemplateListResponse>(`/templates${queryString({ faculty, estado, search })}`),
  });

  const save = useMutation({
    mutationFn: async (payload: { id: string | null; body: unknown }) =>
      payload.id
        ? apiFetch(`/templates/${payload.id}`, { method: 'PATCH', body: payload.body })
        : apiFetch('/templates', { method: 'POST', body: payload.body }),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo guardar la plantilla.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  const templates = listQuery.data?.templates ?? [];
  const resumen = listQuery.data?.resumen;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Plantillas de programa</h1>
          <p>
            El dato oficial de cada programa. Es lo unico que la IA puede citar cuando un aspirante
            pregunta por costos: sin plantilla vigente y con valor cargado, la respuesta remite a
            admisiones en lugar de arriesgar una cifra.
          </p>
        </div>
        {editable ? (
          <button
            type="button"
            className="primary"
            onClick={() => {
              setError(null);
              setEditing({ id: null, draft: { ...EMPTY } });
            }}
          >
            <i className="bx bx-plus" aria-hidden="true"></i> Nueva plantilla
          </button>
        ) : null}
      </div>

      {resumen ? (
        <ul className="box-info">
          <li className="tone-green">
            <i className="bx bxs-check-shield" aria-hidden="true"></i>
            <span className="text">
              <h3>{resumen.usables}</h3>
              <p>Listas para responder costos</p>
            </span>
          </li>
          <li className="tone-orange">
            <i className="bx bxs-edit" aria-hidden="true"></i>
            <span className="text">
              <h3>{resumen.sinCosto}</h3>
              <p>Sin valor cargado</p>
            </span>
          </li>
          <li className="tone-red">
            <i className="bx bxs-time-five" aria-hidden="true"></i>
            <span className="text">
              <h3>{resumen.vencidas}</h3>
              <p>Vigencia vencida</p>
            </span>
          </li>
          <li className="tone-blue">
            <i className="bx bxs-book-content" aria-hidden="true"></i>
            <span className="text">
              <h3>{resumen.total}</h3>
              <p>Programas registrados</p>
            </span>
          </li>
        </ul>
      ) : null}

      {resumen && resumen.usables === 0 && resumen.total > 0 ? (
        <Notice kind="warning">
          Ninguna plantilla tiene valor cargado todavia, asi que la IA aun no responde preguntas de
          costos: las remite a admisiones. Cargue el valor del semestre y la vigencia para que
          empiece a citarlos.
        </Notice>
      ) : null}

      <div className="toolbar">
        <div className="field">
          <label htmlFor="t-faculty">Facultad</label>
          <select id="t-faculty" value={faculty} onChange={(event) => setFaculty(event.target.value)}>
            <option value="">Todas</option>
            {FACULTIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="t-estado">Estado</label>
          <select id="t-estado" value={estado} onChange={(event) => setEstado(event.target.value)}>
            <option value="todas">Todas</option>
            <option value="vigentes">Vigentes</option>
            <option value="vencidas">Vencidas</option>
            <option value="sin_costo">Sin valor cargado</option>
          </select>
        </div>

        <div className="field" style={{ flexGrow: 1 }}>
          <label htmlFor="t-search">Buscar programa</label>
          <input
            id="t-search"
            type="search"
            placeholder="Contaduria, Administracion..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      {listQuery.isLoading ? (
        <div className="card">Cargando plantillas...</div>
      ) : templates.length === 0 ? (
        <div className="card empty">No hay plantillas con esos filtros.</div>
      ) : (
        <div className="template-grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              editable={editable}
              onEdit={() => {
                setError(null);
                setEditing({ id: template.id, draft: toDraft(template) });
              }}
              onDelete={() => {
                if (window.confirm(`Eliminar la plantilla de ${template.name}?`)) {
                  remove.mutate(template.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {editing ? (
        <TemplateEditor
          value={editing.draft}
          isNew={editing.id === null}
          saving={save.isPending}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onCancel={() => setEditing(null)}
          onSave={() => save.mutate({ id: editing.id, body: toPayload(editing.draft) })}
        />
      ) : null}
    </>
  );
}

/**
 * Un color y un icono por facultad, en vez de una fotografia de archivo.
 *
 * La propia institucion distingue sus facultades por caracter -"Veterinaria
 * no suena igual que Derecho"- asi que el color no es decorativo: es la
 * misma senal que ya usa el tono institucional, llevada a la interfaz.
 */
const FACULTY_STYLE: Record<string, { color: string; icon: string }> = {
  'Ciencias de la Salud': { color: '#0f8b8d', icon: 'bxs-first-aid' },
  'Ciencias Empresariales': { color: '#3556c9', icon: 'bxs-briefcase' },
  'Ciencias Contables': { color: '#a8711c', icon: 'bxs-calculator' },
  'Ciencias Juridicas y Politicas': { color: '#8a2846', icon: 'bxs-bank' },
  Ingenierias: { color: '#3b4a63', icon: 'bxs-cog' },
  Diseno: { color: '#a3266b', icon: 'bxs-brush' },
  'Medicina Veterinaria': { color: '#2f6b3f', icon: 'bxs-leaf' },
};

const DEFAULT_FACULTY_STYLE = { color: '#4a4f57', icon: 'bxs-graduation' };

function facultyStyle(faculty: string) {
  return FACULTY_STYLE[faculty] ?? DEFAULT_FACULTY_STYLE;
}

/** Las dos iniciales que sirven de monograma del programa: "Contaduria Publica" -> "CP". */
function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(de|del|la|las|el|los|y|en|a)$/i.test(word));

  const letters = (words.length > 0 ? words : name.split(/\s+/)).slice(0, 2).map((word) => word[0]);
  return letters.join('').toUpperCase() || '--';
}

function TemplateCard({
  template,
  editable,
  onEdit,
  onDelete,
}: {
  template: ProgramTemplate & { vigente: boolean; usable: boolean };
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const style = facultyStyle(template.faculty);

  const estado = !template.isActive
    ? { label: 'Inactiva', tone: 'off', icon: 'bx-hide' }
    : template.semesterValue === null
      ? { label: 'Falta el valor', tone: 'pending', icon: 'bx-error' }
      : !template.vigente
        ? { label: 'Vencida', tone: 'expired', icon: 'bx-calendar-x' }
        : { label: 'En uso', tone: 'live', icon: 'bx-check-shield' };

  const facts: Array<{ label: string; value: string }> = [
    template.professionalProfile
      ? { label: 'Perfil profesional', value: template.professionalProfile }
      : null,
    template.scheduleNote ? { label: 'Horarios', value: template.scheduleNote } : null,
    template.admissionProcess
      ? { label: 'Proceso de inscripcion', value: template.admissionProcess }
      : null,
    template.requirements ? { label: 'Requisitos', value: template.requirements } : null,
    template.homologationNote
      ? { label: 'Homologaciones', value: template.homologationNote }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <article className={`tpl-card ${!template.isActive ? 'is-off' : ''}`}>
      {/* Cabecera sin fotografia: color de facultad, textura por CSS, icono y
          monograma del programa. */}
      <div className="tpl-card__crest" style={{ '--crest': style.color } as React.CSSProperties}>
        <i className={`bx ${style.icon} tpl-card__crest-icon`} aria-hidden="true"></i>
        <span className="tpl-card__modality">
          {MODALITY_LABEL[template.modality] ?? template.modality}
        </span>
        <span className="tpl-card__mono" aria-hidden="true">
          {monogram(template.name)}
        </span>
        <span className={`tpl-card__stamp tpl-card__stamp--${estado.tone}`}>
          <i className={`bx ${estado.icon}`} aria-hidden="true"></i> {estado.label}
        </span>
      </div>

      <div className="tpl-card__body">
        <h3>{template.name}</h3>
        <p className="tpl-card__faculty">{template.faculty}</p>

        <div className="tpl-card__tags">
          <span className="badge badge--info">{LEVEL_LABEL[template.level] ?? template.level}</span>
          {template.durationSemesters ? (
            <span className="badge">{template.durationSemesters} semestres</span>
          ) : null}
          {template.degreeAwarded ? <span className="badge">{template.degreeAwarded}</span> : null}
        </div>

        <div className="tpl-card__price">
          {template.semesterValue === null ? (
            <>
              <span className="tpl-card__amount is-missing">Sin cargar</span>
              <small>Admisiones debe registrar el valor del semestre</small>
            </>
          ) : (
            <>
              <span className="tpl-card__amount">{COP.format(template.semesterValue)}</span>
              <small>
                por semestre
                {template.costIsPublic ? '' : ' · solo por mensaje directo'}
              </small>
            </>
          )}
        </div>

        <button
          type="button"
          className="tpl-card__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Ver menos' : 'Ver detalle del programa'}
          <i className="bx bx-chevron-down" aria-hidden="true"></i>
        </button>
      </div>

      <div className="tpl-card__flap" data-open={open}>
        <div className="tpl-card__flap-inner">
          <div className="tpl-card__flap-body">
            {template.description ? (
              <p className="tpl-card__desc">{template.description}</p>
            ) : (
              <p className="tpl-card__desc is-empty">Sin descripcion del programa todavia.</p>
            )}

            {facts.map((fact) => (
              <p key={fact.label} className="tpl-card__fact">
                <strong>{fact.label}</strong>
                {fact.value}
              </p>
            ))}

            {template.validUntil ? (
              <p className="tpl-card__validity">
                <i className="bx bx-calendar" aria-hidden="true"></i> Vigente hasta{' '}
                {new Date(template.validUntil).toLocaleDateString('es-CO', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            ) : (
              <p className="tpl-card__validity is-missing">
                <i className="bx bx-calendar-exclamation" aria-hidden="true"></i> Sin vigencia
                definida
              </p>
            )}

            {template.discountNote ? <p className="tpl-card__note">{template.discountNote}</p> : null}

            <ContentMeter template={template} />

            {editable ? (
              <div className="tpl-card__actions">
                <button type="button" onClick={onEdit}>
                  <i className="bx bx-edit-alt" aria-hidden="true"></i> Editar
                </button>
                <button type="button" className="danger" onClick={onDelete}>
                  Eliminar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Cuanto contenido tiene diligenciada la plantilla.
 *
 * No es una metrica de vanidad: cada campo lleno es una pregunta que la IA
 * puede resolver sin pasar por una persona. Una plantilla con solo el precio
 * responde el precio; una completa responde tambien horarios, homologaciones
 * y perfil profesional.
 */
function ContentMeter({ template }: { template: ProgramTemplate }) {
  const fields = [
    template.description,
    template.professionalProfile,
    template.curriculum,
    template.scheduleNote,
    template.admissionProcess,
    template.homologationNote,
    template.requirements,
    template.faq,
  ];

  const filled = fields.filter((field) => field && field.trim().length > 0).length;
  const percent = Math.round((filled / fields.length) * 100);

  return (
    <div className="template-meter" title={`${filled} de ${fields.length} campos de contenido`}>
      <div className="template-meter__track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="template-meter__label">
        {filled}/{fields.length} campos
      </span>
    </div>
  );
}


function TemplateEditor({
  value,
  isNew,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  value: TemplateDraft;
  isNew: boolean;
  saving: boolean;
  onChange: (draft: TemplateDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof TemplateDraft>(key: K, next: TemplateDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Editor de plantilla">
        <header className="drawer__head">
          <h2>{isNew ? 'Nueva plantilla' : value.name}</h2>
          <button type="button" className="drawer__close" onClick={onCancel} aria-label="Cerrar">
            <i className="bx bx-x bx-sm" aria-hidden="true"></i>
          </button>
        </header>

        <form
          className="drawer__body"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="field">
            <label htmlFor="e-name">Nombre del programa</label>
            <input
              id="e-name"
              value={value.name}
              maxLength={160}
              onChange={(event) => set('name', event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="e-faculty">Facultad</label>
            <select
              id="e-faculty"
              value={value.faculty}
              onChange={(event) => set('faculty', event.target.value)}
            >
              {FACULTIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="drawer__row">
            <div className="field">
              <label htmlFor="e-level">Nivel</label>
              <select
                id="e-level"
                value={value.level}
                onChange={(event) => set('level', event.target.value)}
              >
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {LEVEL_LABEL[item]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="e-modality">Modalidad</label>
              <select
                id="e-modality"
                value={value.modality}
                onChange={(event) => set('modality', event.target.value)}
              >
                {MODALITIES.map((item) => (
                  <option key={item} value={item}>
                    {MODALITY_LABEL[item]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="e-campuses">Sedes donde se ofrece</label>
            <input
              id="e-campuses"
              value={value.campuses}
              onChange={(event) => set('campuses', event.target.value)}
              placeholder="Medellin, Cali, Bogota"
            />
          </div>

          <h3 className="drawer__section">Costos</h3>
          <p className="drawer__hint">
            Deje el valor en blanco si aun no esta confirmado. Una plantilla sin valor no se usa
            para responder: la IA remite a admisiones, que es preferible a publicar una cifra
            equivocada.
          </p>

          <div className="drawer__row">
            <div className="field">
              <label htmlFor="e-semester">Valor del semestre (COP)</label>
              <input
                id="e-semester"
                type="number"
                min={0}
                step={1000}
                value={value.semesterValue}
                onChange={(event) => set('semesterValue', event.target.value)}
                placeholder="Sin cargar"
              />
            </div>

            <div className="field">
              <label htmlFor="e-enrollment">Derechos de matricula (COP)</label>
              <input
                id="e-enrollment"
                type="number"
                min={0}
                step={1000}
                value={value.enrollmentFee}
                onChange={(event) => set('enrollmentFee', event.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="e-discount">Descuentos vigentes</label>
            <input
              id="e-discount"
              value={value.discountNote}
              maxLength={500}
              onChange={(event) => set('discountNote', event.target.value)}
              placeholder="7 % por pronto pago"
            />
          </div>

          <div className="field">
            <label htmlFor="e-otherfees">Otros conceptos</label>
            <input
              id="e-otherfees"
              value={value.otherFeesNote}
              maxLength={500}
              onChange={(event) => set('otherFeesNote', event.target.value)}
              placeholder="Carne, seguro estudiantil, derechos de grado"
            />
          </div>

          <label className="drawer__check">
            <input
              type="checkbox"
              checked={value.costIsPublic}
              onChange={(event) => set('costIsPublic', event.target.checked)}
            />
            <span>
              El valor puede darse en un comentario publico
              <small>
                Si lo desmarca, la IA solo lo menciona por mensaje directo e invita a escribir por
                ahi.
              </small>
            </span>
          </label>

          <h3 className="drawer__section">Vigencia</h3>
          <p className="drawer__hint">
            Fuera de estas fechas la plantilla deja de usarse automaticamente. Un valor de matricula
            del ano pasado publicado en un comentario abierto cuesta mas que no haber respondido.
          </p>

          <div className="drawer__row">
            <div className="field">
              <label htmlFor="e-from">Valida desde</label>
              <input
                id="e-from"
                type="date"
                value={value.validFrom}
                onChange={(event) => set('validFrom', event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="e-until">Valida hasta</label>
              <input
                id="e-until"
                type="date"
                value={value.validUntil}
                onChange={(event) => set('validUntil', event.target.value)}
              />
            </div>
          </div>

          <h3 className="drawer__section">Detalle academico</h3>

          <div className="drawer__row">
            <div className="field">
              <label htmlFor="e-duration">Duracion (semestres)</label>
              <input
                id="e-duration"
                type="number"
                min={1}
                max={30}
                value={value.durationSemesters}
                onChange={(event) => set('durationSemesters', event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="e-credits">Creditos</label>
              <input
                id="e-credits"
                type="number"
                min={1}
                max={400}
                value={value.credits}
                onChange={(event) => set('credits', event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="e-req">Requisitos de admision</label>
            <textarea
              id="e-req"
              value={value.requirements}
              maxLength={1000}
              onChange={(event) => set('requirements', event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="e-url">Enlace oficial del programa</label>
            <input
              id="e-url"
              type="url"
              value={value.officialUrl}
              onChange={(event) => set('officialUrl', event.target.value)}
              placeholder="https://www.uniremington.edu.co/..."
            />
          </div>

          <h3 className="drawer__section">Contenido del programa</h3>
          <p className="drawer__hint">
            Todo lo que escriba aqui queda disponible para que la IA lo cite. Entre mejor
            diligenciada este la plantilla, mas preguntas resuelve sin pasar por una persona.
          </p>

          <div className="drawer__row">
            <div className="field">
              <label htmlFor="e-degree">Titulo que otorga</label>
              <input
                id="e-degree"
                value={value.degreeAwarded}
                maxLength={200}
                onChange={(event) => set('degreeAwarded', event.target.value)}
                placeholder="Administrador de Empresas"
              />
            </div>
            <div className="field">
              <label htmlFor="e-snies">Codigo SNIES</label>
              <input
                id="e-snies"
                value={value.sniesCode}
                maxLength={40}
                onChange={(event) => set('sniesCode', event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="e-desc">Sobre el programa</label>
            <textarea
              id="e-desc"
              value={value.description}
              maxLength={2000}
              onChange={(event) => set('description', event.target.value)}
              placeholder="De que se trata, en lenguaje de aspirante."
            />
          </div>

          <div className="field">
            <label htmlFor="e-profile">Perfil profesional y campo laboral</label>
            <textarea
              id="e-profile"
              value={value.professionalProfile}
              maxLength={2000}
              onChange={(event) => set('professionalProfile', event.target.value)}
              placeholder="Donde trabaja el egresado, que puede ejercer."
            />
          </div>

          <div className="field">
            <label htmlFor="e-curriculum">Plan de estudios destacado</label>
            <textarea
              id="e-curriculum"
              value={value.curriculum}
              maxLength={2000}
              onChange={(event) => set('curriculum', event.target.value)}
              placeholder="Areas y materias principales."
            />
          </div>

          <div className="field">
            <label htmlFor="e-schedule">Horarios y jornadas</label>
            <textarea
              id="e-schedule"
              value={value.scheduleNote}
              maxLength={600}
              onChange={(event) => set('scheduleNote', event.target.value)}
              placeholder="Sabados de 7 a. m. a 1 p. m., por ejemplo."
            />
          </div>

          <div className="field">
            <label htmlFor="e-admission">Proceso de inscripcion</label>
            <textarea
              id="e-admission"
              value={value.admissionProcess}
              maxLength={1500}
              onChange={(event) => set('admissionProcess', event.target.value)}
              placeholder="Pasos y fechas del proceso."
            />
          </div>

          <div className="field">
            <label htmlFor="e-homolog">Homologaciones</label>
            <textarea
              id="e-homolog"
              value={value.homologationNote}
              maxLength={1000}
              onChange={(event) => set('homologationNote', event.target.value)}
              placeholder="Que se homologa y como se solicita."
            />
          </div>

          <div className="field">
            <label htmlFor="e-faq">Preguntas frecuentes del programa</label>
            <textarea
              id="e-faq"
              value={value.faq}
              maxLength={3000}
              onChange={(event) => set('faq', event.target.value)}
              placeholder="Una pregunta y su respuesta por linea."
              style={{ minHeight: 140 }}
            />
          </div>

          <div className="field">
            <label htmlFor="e-notes">Notas internas</label>
            <textarea
              id="e-notes"
              value={value.notes}
              maxLength={1000}
              onChange={(event) => set('notes', event.target.value)}
            />
          </div>

          <label className="drawer__check">
            <input
              type="checkbox"
              checked={value.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            <span>Plantilla activa</span>
          </label>

          <div className="drawer__actions">
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar plantilla'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
