/** Demo dataset (Spanish, realistic). Passwords are documented in server/README.md. */

export const DEFAULT_SEED_TAG = 'DEMO';

export const PASSWORDS = {
  admin: 'Admin2026!',
  coordinator: 'Coord2026!',
  juror: 'Jurado2026!',
  student: 'Estudiante2026!',
} as const;

export const PROGRAM = {
  code: 'MIETIA',
  name: 'Maestría en Innovación Educativa con Tecnología e Inteligencia Artificial',
};

export interface PersonSeed {
  firstName: string;
  lastName: string;
  documentId: string;
}

export const ADMIN: PersonSeed & { email: string } = {
  email: 'admin@unicordoba.edu.co',
  firstName: 'Carlos Andrés',
  lastName: 'Rivera Cárdenas',
  documentId: '1067845123',
};

export const COORDINATOR: PersonSeed & { email: string } = {
  email: 'coordinador@unicordoba.edu.co',
  firstName: 'Martha Lucía',
  lastName: 'Pérez Doria',
  documentId: '50912334',
};

export interface InternalJurorSeed extends PersonSeed {
  highestDegree: string;
  expertise: string[];
}

/** jurado1..6@unicordoba.edu.co, in this order. */
export const INTERNAL_JURORS: InternalJurorSeed[] = [
  {
    firstName: 'Luis Fernando',
    lastName: 'Martínez Ramos',
    documentId: '78034512',
    highestDegree: 'Doctorado en Ciencias de la Computación',
    expertise: ['Inteligencia artificial', 'Aprendizaje automático'],
  },
  {
    firstName: 'Ana María',
    lastName: 'Hoyos Petro',
    documentId: '34987651',
    highestDegree: 'Doctorado en Educación',
    expertise: ['Tecnología educativa', 'Didáctica'],
  },
  {
    firstName: 'Jorge Eliécer',
    lastName: 'Díaz Sáenz',
    documentId: '10776543',
    highestDegree: 'Doctorado en Ingeniería',
    expertise: ['Sistemas de información', 'Ingeniería de software'],
  },
  {
    firstName: 'Claudia Patricia',
    lastName: 'Vergara Lora',
    documentId: '25876901',
    highestDegree: 'Doctorado en Estadística',
    expertise: ['Ciencia de datos', 'Analítica del aprendizaje'],
  },
  {
    firstName: 'Rafael Antonio',
    lastName: 'Negrete Montes',
    documentId: '15032876',
    highestDegree: 'Doctorado en Ciencias de la Educación',
    expertise: ['Robótica educativa', 'Pensamiento computacional'],
  },
  {
    firstName: 'Sandra Milena',
    lastName: 'Cogollo Ruiz',
    documentId: '30654789',
    highestDegree: 'Doctorado en Psicología Educativa',
    expertise: ['Evaluación del aprendizaje', 'Inclusión educativa'],
  },
];

export interface ExternalJurorSeed {
  email: string;
  firstName: string;
  lastName: string;
  institution: string;
  highestDegree: string;
  country: string;
}

/** External-only jurors: token access, no password. */
export const EXTERNAL_JURORS: ExternalJurorSeed[] = [
  {
    email: 'diego.quintero@externo.example.org',
    firstName: 'Diego Alejandro',
    lastName: 'Quintero Gómez',
    institution: 'Universidad Nacional de Colombia',
    highestDegree: 'Doctorado en Informática Educativa',
    country: 'Colombia',
  },
  {
    email: 'mariajose.fernandez@externo.example.org',
    firstName: 'María José',
    lastName: 'Fernández Ortega',
    institution: 'Universidad de Granada',
    highestDegree: 'Doctorado en Tecnología Educativa',
    country: 'España',
  },
  {
    email: 'ricardo.salazar@externo.example.org',
    firstName: 'Ricardo',
    lastName: 'Salazar Urrego',
    institution: 'Universidad de Antioquia',
    highestDegree: 'Doctorado en Educación',
    country: 'Colombia',
  },
];

/** estudiante1..15@correo.unicordoba.edu.co, in this order. */
export const STUDENTS: PersonSeed[] = [
  {
    firstName: 'Valentina',
    lastName: 'Arrieta Sánchez',
    documentId: '1003456781',
  },
  {
    firstName: 'Santiago',
    lastName: 'Montes Villadiego',
    documentId: '1003456782',
  },
  {
    firstName: 'Camila Andrea',
    lastName: 'Ortega Pacheco',
    documentId: '1003456783',
  },
  {
    firstName: 'Juan David',
    lastName: 'Ramírez Lugo',
    documentId: '1003456784',
  },
  { firstName: 'Daniela', lastName: 'Bula Espitia', documentId: '1003456785' },
  {
    firstName: 'Andrés Felipe',
    lastName: 'Causil Mendoza',
    documentId: '1003456786',
  },
  {
    firstName: 'Laura Sofía',
    lastName: 'Polo Agámez',
    documentId: '1003456787',
  },
  {
    firstName: 'Sebastián',
    lastName: 'Lambraño Torres',
    documentId: '1003456788',
  },
  {
    firstName: 'María Fernanda',
    lastName: 'Galván Petro',
    documentId: '1003456789',
  },
  {
    firstName: 'Kevin Alberto',
    lastName: 'Suárez Humanez',
    documentId: '1003456790',
  },
  {
    firstName: 'Isabella',
    lastName: 'Cuadrado Ríos',
    documentId: '1003456791',
  },
  {
    firstName: 'Mateo',
    lastName: 'Hernández Begambre',
    documentId: '1003456792',
  },
  {
    firstName: 'Natalia',
    lastName: 'Vásquez Correa',
    documentId: '1003456793',
  },
  {
    firstName: 'Diego Armando',
    lastName: 'Pérez Montalvo',
    documentId: '1003456794',
  },
  {
    firstName: 'Paola Andrea',
    lastName: 'Jiménez Oviedo',
    documentId: '1003456795',
  },
];

export interface ThesisTopic {
  title: string;
  abstract: string;
  keywords: string[];
}

/** One topic per student (same order). */
export const TOPICS: ThesisTopic[] = [
  {
    title:
      'Tutor inteligente basado en modelos de lenguaje para la enseñanza de fracciones en básica primaria',
    abstract:
      'Se diseña y valida un tutor conversacional que acompaña a estudiantes de quinto grado en la resolución de problemas con fracciones.',
    keywords: ['tutor inteligente', 'modelos de lenguaje', 'matemáticas'],
  },
  {
    title:
      'Analítica del aprendizaje para la detección temprana de deserción en programas virtuales',
    abstract:
      'Se construye un modelo predictivo con datos del LMS institucional para identificar estudiantes en riesgo de abandono.',
    keywords: ['analítica del aprendizaje', 'deserción', 'educación virtual'],
  },
  {
    title:
      'Realidad aumentada para la comprensión de ecosistemas del río Sinú en educación media',
    abstract:
      'Se evalúa el efecto de una aplicación de realidad aumentada sobre la comprensión de conceptos ecológicos locales.',
    keywords: ['realidad aumentada', 'ciencias naturales', 'contexto regional'],
  },
  {
    title:
      'Gamificación y motivación en cursos de programación introductoria universitaria',
    abstract:
      'Se compara el desempeño y la motivación de dos grupos de programación con y sin estrategias de gamificación.',
    keywords: ['gamificación', 'programación', 'motivación'],
  },
  {
    title:
      'Retroalimentación automática con IA generativa en la escritura argumentativa',
    abstract:
      'Se analiza la calidad de la retroalimentación generada por IA frente a la docente en textos argumentativos de grado once.',
    keywords: ['IA generativa', 'escritura', 'retroalimentación'],
  },
  {
    title:
      'Pensamiento computacional mediante robótica educativa en zonas rurales de Córdoba',
    abstract:
      'Se implementa una secuencia didáctica con kits de robótica de bajo costo en instituciones rurales.',
    keywords: ['pensamiento computacional', 'robótica', 'ruralidad'],
  },
  {
    title:
      'Chatbot de orientación vocacional para estudiantes de undécimo grado',
    abstract:
      'Se desarrolla un asistente conversacional que integra pruebas de intereses y oferta académica regional.',
    keywords: ['chatbot', 'orientación vocacional', 'educación media'],
  },
  {
    title:
      'Aprendizaje adaptativo en la enseñanza del inglés como lengua extranjera',
    abstract:
      'Se valida una plataforma adaptativa que ajusta la dificultad de las actividades según el desempeño del estudiante.',
    keywords: ['aprendizaje adaptativo', 'inglés', 'personalización'],
  },
  {
    title:
      'Competencias digitales docentes en instituciones oficiales de Montería',
    abstract:
      'Se caracterizan las competencias digitales de docentes de educación básica con el marco DigCompEdu.',
    keywords: ['competencias digitales', 'docentes', 'DigCompEdu'],
  },
  {
    title:
      'Detección de plagio asistido por IA en trabajos escritos universitarios',
    abstract:
      'Se evalúan herramientas de detección de textos generados por IA y sus implicaciones éticas en la evaluación.',
    keywords: ['integridad académica', 'IA', 'evaluación'],
  },
  {
    title:
      'Laboratorios virtuales de física para la comprensión del movimiento ondulatorio',
    abstract:
      'Se compara el aprendizaje conceptual con laboratorios virtuales frente a prácticas tradicionales.',
    keywords: ['laboratorios virtuales', 'física', 'simulación'],
  },
  {
    title:
      'Uso de redes sociales como entorno de aprendizaje informal en estudiantes de pregrado',
    abstract:
      'Se describe cómo los estudiantes usan redes sociales para aprender y su relación con el rendimiento académico.',
    keywords: ['redes sociales', 'aprendizaje informal', 'pregrado'],
  },
  {
    title:
      'Modelo de evaluación formativa apoyado en rúbricas digitales para educación media técnica',
    abstract:
      'Se propone y valida un modelo de evaluación formativa con rúbricas digitales en programas de articulación técnica.',
    keywords: ['evaluación formativa', 'rúbricas', 'media técnica'],
  },
  {
    title:
      'Asistente de voz para la inclusión de estudiantes con discapacidad visual en el aula',
    abstract:
      'Se desarrolla y evalúa un asistente de voz que facilita el acceso a materiales digitales del curso.',
    keywords: ['inclusión', 'discapacidad visual', 'asistente de voz'],
  },
  {
    title:
      'Minería de datos educativos para el análisis de resultados Saber 11 en Córdoba',
    abstract:
      'Se aplican técnicas de minería de datos para identificar factores asociados al desempeño en las pruebas Saber 11.',
    keywords: ['minería de datos', 'Saber 11', 'factores asociados'],
  },
];
