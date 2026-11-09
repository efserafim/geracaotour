// Edite estes valores para personalizar o passeio antes de publicar.
export const SITE_CONFIG = {
  tourName: "Peregrinação Jovem — Geração Eucarística",
  tourDate: "5 de dezembro de 2026",
  tourDateISO: "2026-12-05",
  departureTime: "06:30",
  capacity: 33,
  videoUrl: "https://www.youtube.com/embed/d1X__SuNzmo",
  meetingPoint: "Paróquia Santo Antônio — Bacaxá, Saquarema–RJ",
  itinerary: [
    "06h00: Concentração na Paróquia Santo Antônio, Bacaxá, Saquarema–RJ",
    "06h30: Saída do ônibus",
    "Convento de Santo Antônio, Largo da Carioca, Centro, Rio de Janeiro",
    "Mosteiro de São Bento, Rua Dom Gerardo, 68, Centro",
    "Igreja da Venerável Ordem Terceira de São Francisco da Penitência, Largo do Carioca, 5, Centro",
    "Igreja Nossa Senhora da Paz, Rua Visconde de Pirajá, 339, Ipanema"
  ],

  siteUrl: "https://geracao-tour.netlify.app/",
  shareText: "Sábado 05/12 tem Peregrinação Jovem da Geração Eucarística. De Bacaxá ao Rio, R$ 30. Bora?",
  coordinatorWhatsapp: "5522997812588",
  pixKey: "22998750491",
  pixLabel: "(22) 99875-0491",
  pixName: "Welerson",

  info: {
    price: "R$ 30 no PIX (22) 99875-0491, Welerson. A ficha reserva. O pagamento confirma.",
    returnTime: "",
    deadline: "",
    bring: [
      "Documento com foto",
      "Garrafa de água",
      "Roupa leve e tênis",
      "Boné e protetor solar",
      "Remédio de uso contínuo, se você toma"
    ]
  }
};

// Em produção (Netlify) use caminho relativo. Em outro host, aponte para a URL da API.
export const API_BASE = "/api";
