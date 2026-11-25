// Tipos de las respuestas de la API usados en varias pantallas.
export interface VariantOption {
  id: number;
  productId: number;
  productName: string;
  label: string;
  sku: string;
  size: string | null;
  color: string | null;
  type: string;
  category: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  reserved: number;
  available: number;
  minStock: number;
  customizable: boolean;
}

export interface Customer {
  id: number;
  name: string;
  type: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  tags: string[];
  marketingConsent: boolean;
  creditDays: number;
  archived: boolean;
  ordersCount?: number;
  totalBought?: number;
  balance?: number;
  lastPurchase?: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  supplies: string | null;
  notes: string | null;
  paymentTermDays: number;
  purchasesCount?: number;
  totalBought?: number;
  balance?: number;
  lastPurchase?: string | null;
}

export interface OrderRow {
  id: number;
  number: string;
  kind: 'pedido' | 'venta';
  customerId: number | null;
  customerName: string;
  customerPhone?: string | null;
  status: string;
  priority: string;
  orderDate: string;
  promisedDate: string | null;
  dueDate: string | null;
  total: number | null;
  paid: number | null;
  balance: number | null;
  units: number;
  overdue: boolean;
  createdAt: string;
}

export interface Settings {
  companyName: string;
  nit: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  receiptFooter: string | null;
  sizes: string[];
  colors: string[];
  categories: string[];
  units: string[];
  expenseCategories: string[];
  productionStages: string[];
  paymentMethods: string[];
}
