/**
 * Comentarios de ejemplo para el proveedor mock.
 *
 * Reproducen lo que de verdad llega a las cuentas de Uniremington: preguntas
 * de admision bajo la pieza de campana, quejas de servicios academicos,
 * felicitaciones de grado y casos con dato personal que nunca deben
 * responderse de forma asistida.
 */

export interface FixtureComment {
  author: string;
  text: string;
  /** Indice de la publicacion de FIXTURE_POSTS a la que responde. */
  postIndex: number;
}

export interface FixturePost {
  externalId: string;
  caption: string;
  mediaType: string;
  permalink: string;
}

export const FIXTURE_POSTS: FixturePost[] = [
  {
    externalId: 'post_admisiones_2026_1',
    caption:
      'Inscripciones abiertas 2026-1. Programas presenciales, a distancia y virtuales en siete facultades. Estudia con nosotros.',
    mediaType: 'IMAGE',
    permalink: 'https://www.instagram.com/p/ejemplo-admisiones/',
  },
  {
    externalId: 'post_grados_diciembre',
    caption: 'Ceremonia de grados diciembre. Felicitaciones a nuestros nuevos profesionales.',
    mediaType: 'CAROUSEL_ALBUM',
    permalink: 'https://www.instagram.com/p/ejemplo-grados/',
  },
  {
    externalId: 'post_veterinaria',
    caption: 'Facultad de Medicina Veterinaria: practicas en la granja universitaria.',
    mediaType: 'VIDEO',
    permalink: 'https://www.instagram.com/p/ejemplo-veterinaria/',
  },
  {
    externalId: 'post_derecho_virtual',
    caption: 'Derecho en modalidad virtual. Estudia desde cualquier parte del pais.',
    mediaType: 'IMAGE',
    permalink: 'https://www.facebook.com/uniremington/posts/ejemplo-derecho',
  },
];

export const FIXTURE_COMMENTS: FixtureComment[] = [
  // Interes de matricula: el caso mas frecuente en campana.
  {
    author: 'daniela.gomez',
    text: 'Buenas tardes, cuanto vale el semestre de psicologia y hasta cuando hay plazo para inscribirse?',
    postIndex: 0,
  },
  {
    author: 'jhon_alexander',
    text: 'Hay becas o algun descuento por pronto pago? Estoy trabajando y quiero estudiar los sabados',
    postIndex: 0,
  },
  {
    author: 'marcela.rios87',
    text: 'Me homologan las materias que ya vi en otra universidad? Curse cuatro semestres de contaduria',
    postIndex: 0,
  },
  {
    author: 'estudiantecali',
    text: 'La sede de Cali tambien tiene ingenieria de sistemas presencial?',
    postIndex: 0,
  },
  {
    author: 'sebas.torres',
    text: 'El titulo virtual sirve igual que el presencial para concursos publicos?',
    postIndex: 3,
  },

  // Elogios y grados.
  {
    author: 'luisa.fernanda',
    text: 'Felicitaciones a todos los graduandos! Excelente universidad, la recomiendo mil veces',
    postIndex: 1,
  },
  { author: 'carlos_mejia', text: 'Que orgullo ser egresado de Uniremington', postIndex: 1 },
  {
    author: 'paola.v',
    text: 'Los profesores de veterinaria son muy buenos, se nota el compromiso con los animales',
    postIndex: 2,
  },

  // Quejas y soporte: siempre pasan a una persona.
  {
    author: 'andres.q',
    text: 'Llevo tres dias sin poder pagar en la plataforma, me sale error y nadie contesta el telefono. Pesimo servicio',
    postIndex: 0,
  },
  {
    author: 'natalia.correa',
    text: 'Solicite mi certificado de notas hace un mes y todavia no me lo entregan. Ya voy a poner una tutela',
    postIndex: 3,
  },
  {
    author: 'miguel.ang',
    text: 'Buenas, mi cedula es 1035478921 y necesito que revisen por que no aparece mi homologacion',
    postIndex: 0,
  },
  {
    author: 'sandra.p',
    text: 'Tengo una incapacidad medica y necesito saber si puedo aplazar el semestre sin perder la beca',
    postIndex: 0,
  },

  // Casos limite.
  {
    author: 'promo_facil',
    text: 'GANA DINERO DESDE CASA escribeme al wasap 3001234567 trabajo online',
    postIndex: 1,
  },
  { author: 'juanjo', text: 'Y la sede de Pereira sigue abierta?', postIndex: 3 },
  {
    author: 'camila.z',
    text: 'Hola, quiero informacion del programa de enfermeria por favor',
    postIndex: 0,
  },
];
