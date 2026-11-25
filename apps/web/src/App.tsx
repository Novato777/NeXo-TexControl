import type { Module } from '@nexo/shared';
import { ShieldAlert } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ButtonLink } from './components/ui/Button';
import { EmptyState, Spinner } from './components/ui/Feedback';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const OrdersPage = lazy(() => import('./pages/orders/OrdersPage'));
const OrderWizard = lazy(() => import('./pages/orders/OrderWizard'));
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'));
const QuickSale = lazy(() => import('./pages/orders/QuickSale'));
const ProductionPage = lazy(() => import('./pages/production/ProductionPage'));
const ProductionDetail = lazy(() => import('./pages/production/ProductionDetail'));
const DeliveriesPage = lazy(() => import('./pages/DeliveriesPage'));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'));
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'));
const ProductForm = lazy(() => import('./pages/products/ProductForm'));
const ProductDetail = lazy(() => import('./pages/products/ProductDetail'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const CustomerDetail = lazy(() => import('./pages/customers/CustomerDetail'));
const SuppliersPage = lazy(() => import('./pages/suppliers/SuppliersPage'));
const SupplierDetail = lazy(() => import('./pages/suppliers/SupplierDetail'));
const PurchaseForm = lazy(() => import('./pages/suppliers/PurchaseForm'));
const PurchaseDetail = lazy(() => import('./pages/suppliers/PurchaseDetail'));
const CashPage = lazy(() => import('./pages/cash/CashPage'));
const CashSessionDetail = lazy(() => import('./pages/cash/CashSessionDetail'));
const ReceivablesPage = lazy(() => import('./pages/ReceivablesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const PrintPage = lazy(() => import('./pages/print/PrintPage'));

function Guard({ module, children }: { module: Module; children: ReactNode }) {
  const { access } = useAuth();
  if (!access(module)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Tu usuario no tiene acceso a esta sección"
        text="Si necesitas entrar aquí, pídele al administrador que revise tu rol en Configuración."
        action={<ButtonLink to="/">Volver al inicio</ButtonLink>}
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Abriendo TexControl…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="/ingresar" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/ingresar" replace state={{ from: loc.pathname + loc.search }} />} />
      </Routes>
    );
  }
  const g = (m: Module, el: ReactNode) => <Guard module={m}>{el}</Guard>;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/ingresar" element={<Navigate to={(loc.state as { from?: string } | null)?.from ?? '/'} replace />} />
        <Route path="/imprimir/:kind/:id" element={<PrintPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="pedidos" element={g('pedidos', <OrdersPage />)} />
          <Route path="pedidos/nuevo" element={g('pedidos', <OrderWizard />)} />
          <Route path="pedidos/:id" element={g('pedidos', <OrderDetail />)} />
          <Route path="venta-rapida" element={g('pedidos', <QuickSale />)} />
          <Route path="produccion" element={g('produccion', <ProductionPage />)} />
          <Route path="produccion/:id" element={g('produccion', <ProductionDetail />)} />
          <Route path="entregas" element={g('entregas', <DeliveriesPage />)} />
          <Route path="inventario" element={g('inventario', <InventoryPage />)} />
          <Route path="productos" element={g('productos', <ProductsPage />)} />
          <Route path="productos/nuevo" element={g('productos', <ProductForm />)} />
          <Route path="productos/:id" element={g('productos', <ProductDetail />)} />
          <Route path="productos/:id/editar" element={g('productos', <ProductForm />)} />
          <Route path="clientes" element={g('clientes', <CustomersPage />)} />
          <Route path="clientes/:id" element={g('clientes', <CustomerDetail />)} />
          <Route path="proveedores" element={g('proveedores', <SuppliersPage />)} />
          <Route path="proveedores/:id" element={g('proveedores', <SupplierDetail />)} />
          <Route path="compras/nueva" element={g('proveedores', <PurchaseForm />)} />
          <Route path="compras/:id" element={g('proveedores', <PurchaseDetail />)} />
          <Route path="caja" element={g('caja', <CashPage />)} />
          <Route path="caja/:id" element={g('caja', <CashSessionDetail />)} />
          <Route path="cartera" element={g('cartera', <ReceivablesPage />)} />
          <Route path="reportes" element={g('reportes', <ReportsPage />)} />
          <Route path="analisis" element={g('analisis', <AnalysisPage />)} />
          <Route path="marketing" element={g('marketing', <MarketingPage />)} />
          <Route path="configuracion" element={g('configuracion', <SettingsPage />)} />
          <Route
            path="*"
            element={<EmptyState title="Esta página no existe" text="Puede que el enlace esté mal escrito o que la página se haya movido." action={<ButtonLink to="/">Ir al inicio</ButtonLink>} />}
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
