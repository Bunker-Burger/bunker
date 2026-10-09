import type { Category, Product } from "@/domain/types";

const images = {
  double: "https://lh3.googleusercontent.com/aida-public/AB6AXuCbAIlwAQyd01V9jkDGFyhimsk-mXpvbHL61YlyY-xESy0XpygcZu6sXrinKe7FVs08NLT8EM5WhBt8XGt63HA9hjD7tfZnHNl-s4dPdTfn2q7fMA9RSpPzaYm2rGoLBNb1kf9bAwMqvQuAt3rX4MkVVaE_tcT8R28HdK9Gw4UDBLM8-r5Ya4BYoUT1B0v_jwZAo1GXxtBo7ozi5-mQOrQPkaAlx0cUxRio4bcjpRWz6RWDxwYDjF-o_vjxkzE0cq1W",
  onion: "https://lh3.googleusercontent.com/aida-public/AB6AXuC28p664-kxsBr_rFkJwx0tehXeyFB6yRv6D_RcGDIcjzIr7vSFAkoNr8xys6bI_FsV3KaDorZV1Jo9MHHtPsvKwIWgq0AU2Ec6G9Vr2vPxtZwNVjuNRRqZwr5PkPPD9it8sZXxDTDSnp61095zB-N7I8s0KaLP7mJBCximCexv_UH3IaWC8GermkC_-5HTPCDspd73lRAe5ZM7g6uwKOdwiDRAo5tml8J-szK6rfV3qco1bOMp93Q",
  chicken: "https://lh3.googleusercontent.com/aida-public/AB6AXuDmC3XTe6Z-QDf9StSEqFz5NRqoRdomQAX0EocjB1EtB7jzkwSjxHFZmVTsDjFU7BoHZ-2zwcSZuqHfQybwekjAoio74NZlxa4Y6BDC1RBYWSt6R1Qz6G7rvKrO4VXBZ4SYEBj9QrmF1xd-29I1NNAc1bwjro9X9KcvhOqV39rCNB7bYI-hTlZkd3z6lmARRHeJkhw7m4HKipv4TozJjmnXeolhawzAPfhWF6qbLAEIkCIoA7oYQOuk",
  pork: "https://lh3.googleusercontent.com/aida-public/AB6AXuBJ-epL1il-yXUf7uPZdKSL78BPUBgnteQm07JEOPfwVOzI1emd-9zuArlhKNXUyrAcBBVQKS_SMlyuQq5VoG2-kBYFt8refyzWEOplPlaAld0PK0D5Ib41WCDiReJcu1oLa7TJtWPE3nFVTRXjlRsQN3ckSZwbcp4emxgpjbAbejjPNZErrJY8r0mUmwsranRBV7MkJKWhUx4_ldCTQATwXQn6gnY5TeiJ9TPkj4JIRLoLMt90uJk",
  fries: "https://lh3.googleusercontent.com/aida-public/AB6AXuD-P1ws-4YhPQXf93H3M-SPJ9v_JoMn4lbzPvUjP-I9BI-R7zIplGoHp1iRszWKMAhf1ZNp23fBgvNwluQ_USkAI0OPki8IgEScoS0ofwC6pnvG9yxyqSIsQu4ECbi1H_KAc5axIlGwXcgNBB2Hm_T6qXn2PEGbZizAc6LiuvBf-6nKfd44i1ig9CqCNGbVL64FyPiZyuYxcq1ZDNilmAOZgixyQGQyDJXflO82Pg",
  rings: "https://lh3.googleusercontent.com/aida-public/AB6AXuB6ZC6NshwcbMQyW6VxRBT2zYpQ5wztW2SLw_mRngWvPumOY37lvBkO2j7AaOZxdq8BeC-FuTgV5hZznzbJQ2YbGzVqFw4XROSRoJHPCW6VUdkxQNkagguJi6cTZEHdgVcf7TM8XV0p-9DkcNqxatV4jQh72sE3Hcuetla6WBxuJ7AilVuNATWUAdAdBLBtHnIov7nBqTLhyZfa6gJRsQgyfeMAIf5z9tAEAvq_Jw",
  soda: "https://lh3.googleusercontent.com/aida-public/AB6AXuDTVWXPnEy3LWz3fXx98rcJEKhVED-DHq7wY8SwqDAkDkh4wzX_py8u0dhGFBJSUxS8GLze-NK712zOG7hJ8DgAsH7VqMHHc-tim2p5LRV0ROR8buMQrH2myss36zDOMrNMUE1mQ4D2giSP7SIViHIvYJj4_cKKMWvR0ENJ6rA7rCheVPbolt8hjWdXfC5-Q9bvx6tTHBy3DhlR3YTXsdGXUvSMy1iZHQ5BVLCaHA",
  lemonade: "https://lh3.googleusercontent.com/aida-public/AB6AXuBfRy3-YgjqjP5gBhhs2VZ34U0sGxiqowhObOWPvynMwDZXg3Q7TzcnmEy9HKjUbHTdE-FXGZxFSqyVxOVVH3UgTSuwWf9ViqwvU6EZzF9OtPHehtxsIZKe7jyo9GSbF2d94Jyco1I1jPxh7i1O52-RqPQ4y0AvOqZgysA-HLfnpE6D14RgpWGvUEx_swdgl02Vjj9dyfI5MIM-S9XWJWNvKsbeRJca9AedG0gIYQ"
};

const burgerOptions = [
  {
    id: "patty",
    name: "Tamaño / medallones",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["double"],
    applicableTypes: ["burger" as const],
    options: [
      { id: "double", name: "Doble (2× 100g)", priceDeltaCents: 0n, available: true },
      { id: "triple", name: "Triple (3× 100g)", priceDeltaCents: 160000n, available: true }
    ]
  },
  {
    id: "extras",
    name: "Extras",
    selectionMode: "multiple" as const,
    required: false,
    minSelections: 0,
    maxSelections: 3,
    defaultOptionIds: [],
    applicableTypes: ["burger" as const, "sandwich" as const],
    options: [
      { id: "bacon", name: "Extra bacon ahumado", priceDeltaCents: 90000n, available: true },
      { id: "cheddar", name: "Cheddar fundido doble", priceDeltaCents: 80000n, available: true },
      { id: "egg", name: "Huevo a la plancha", priceDeltaCents: 60000n, available: true }
    ]
  }
];

const sandwichOptions = [
  {
    id: "bread",
    name: "Tipo de pan",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["brioche"],
    applicableTypes: ["sandwich" as const],
    options: [
      { id: "brioche", name: "Pan brioche tostado", priceDeltaCents: 0n, available: true },
      { id: "potato-roll", name: "Pan de papa", priceDeltaCents: 0n, available: true }
    ]
  }
];

const friesOptions = [
  {
    id: "portion",
    name: "Tamaño de porción",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["regular"],
    applicableTypes: ["fries" as const],
    options: [
      { id: "regular", name: "Regular", priceDeltaCents: 0n, available: true },
      { id: "large", name: "Grande para compartir", priceDeltaCents: 120000n, available: true }
    ]
  }
];

const beverageOptions = [
  {
    id: "ice",
    name: "Hielo",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["with-ice"],
    applicableTypes: ["beverage" as const],
    options: [
      { id: "with-ice", name: "Con hielo", priceDeltaCents: 0n, available: true },
      { id: "no-ice", name: "Sin hielo", priceDeltaCents: 0n, available: true }
    ]
  }
];

export const products: Product[] = [
  { id: "smash-doble", slug: "smash-bunker-doble", categoryId: "burgers", type: "burger", name: "Smash Búnker Doble", description: "Dos medallones smash, doble cheddar, bacon crocante y salsa Búnker.", priceCents: 780000n, imageUrl: images.double, imageAlt: "Hamburguesa doble Búnker", published: true, featured: true, inStock: true, optionGroups: burgerOptions },
  { id: "oklahoma", slug: "oklahoma-onion", categoryId: "burgers", type: "burger", name: "Oklahoma Onion", description: "Cebolla ultrafina smashada, cheddar fundido, pepinillos y mostaza dijon.", priceCents: 720000n, imageUrl: images.onion, imageAlt: "Hamburguesa Oklahoma Onion", published: true, featured: true, inStock: true, optionGroups: burgerOptions },
  { id: "crispy-chicken", slug: "crispy-chicken-bunker", categoryId: "sandwiches", type: "sandwich", name: "Crispy Chicken Búnker", description: "Pechuga extra crujiente, ensalada coleslaw fresca y pepinillo.", priceCents: 680000n, imageUrl: images.chicken, imageAlt: "Sándwich crispy chicken", published: true, featured: false, inStock: true, optionGroups: sandwichOptions },
  { id: "pulled-pork", slug: "pulled-pork-bunker", categoryId: "sandwiches", type: "sandwich", name: "Pulled Pork Búnker", description: "Bondiola braseada lentamente, barbacoa Búnker y pan brioche.", priceCents: 740000n, imageUrl: images.pork, imageAlt: "Sándwich pulled pork", published: true, featured: false, inStock: false, optionGroups: sandwichOptions },
  { id: "papas", slug: "papas-bunker", categoryId: "fries", type: "fries", name: "Papas Búnker", description: "Papas doradas con bacon crocante y cheddar fundido.", priceCents: 350000n, imageUrl: images.fries, imageAlt: "Papas Búnker con cheddar", published: true, featured: false, inStock: true, optionGroups: friesOptions },
  { id: "aros", slug: "aros-de-cebolla", categoryId: "fries", type: "fries", name: "Aros de Cebolla", description: "Rebozado extra crocante con dip de barbacoa.", priceCents: 320000n, imageUrl: images.rings, imageAlt: "Aros de cebolla", published: true, featured: false, inStock: false, optionGroups: friesOptions },
  { id: "gaseosa", slug: "gaseosa-lata", categoryId: "drinks", type: "beverage", name: "Gaseosa Lata 354ml", description: "Bien fría para acompañar tu pedido.", priceCents: 140000n, imageUrl: images.soda, imageAlt: "Gaseosa en lata", published: true, featured: false, inStock: true, containsAlcohol: false, optionGroups: beverageOptions },
  { id: "limonada", slug: "limonada-de-la-casa", categoryId: "drinks", type: "beverage", name: "Limonada de la Casa", description: "Limón exprimido, menta fresca y hielo.", priceCents: 240000n, imageUrl: images.lemonade, imageAlt: "Limonada con menta", published: true, featured: false, inStock: true, containsAlcohol: false, optionGroups: beverageOptions }
];

/** Store time zone; promotion windows are evaluated in it. */
export const STORE_TIMEZONE = "America/Argentina/Tucuman";

export const categoryLabels = {
  burgers: "Hamburguesas",
  sandwiches: "Sándwiches",
  fries: "Papas",
  drinks: "Bebidas"
} as const;

export type StoreCategory = keyof typeof categoryLabels;

/** Categories of the static fallback products (their `categoryId`s), in menu order. */
export const categories: Category[] = [
  { id: "burgers", slug: "hamburguesas", name: categoryLabels.burgers, type: "burger", sortOrder: 10, visible: true },
  { id: "sandwiches", slug: "sandwiches", name: categoryLabels.sandwiches, type: "sandwich", sortOrder: 20, visible: true },
  { id: "fries", slug: "papas", name: categoryLabels.fries, type: "fries", sortOrder: 30, visible: true },
  { id: "drinks", slug: "bebidas", name: categoryLabels.drinks, type: "beverage", sortOrder: 40, visible: true }
];
