import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { formatCurrency } from '../../utils/format';

interface DealProduct {
  id: string;
  dealId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percentage 0-100
  lineTotal: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

interface DealProductsProps {
  dealId: string;
  currentValue: number;
  onValueChange: (v: number) => void;
  /** O valor veio do Flow: os produtos ficam só para leitura (E-15, E-16). */
  somenteLeitura?: boolean;
}

function computeLineTotal(qty: number, unitPrice: number, discount: number): number {
  return qty * unitPrice * (1 - discount / 100);
}

export function DealProducts({ dealId, onValueChange, somenteLeitura = false }: DealProductsProps) {
  const queryClient = useQueryClient();

  // ── Editing state for inline add row ──
  const [addingRow, setAddingRow] = useState(false);
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState(1);
  const [newUnitPrice, setNewUnitPrice] = useState(0);
  const [newDiscount, setNewDiscount] = useState(0);

  // ── Fetch existing line items ──
  const { data: items = [], isLoading: loadingItems } = useQuery<DealProduct[]>({
    queryKey: ['deal-products', dealId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/deals/${dealId}/products`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Falha ao carregar produtos do negócio');
      const json = await res.json();
      return json.data ?? json;
    },
  });

  // ── Fetch product catalog ──
  const { data: catalog = [] } = useQuery<Product[]>({
    queryKey: ['products-catalog'],
    queryFn: async () => {
      const res = await fetch('/api/v1/products?active=true', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Falha ao carregar catálogo');
      const json = await res.json();
      return json.data ?? json;
    },
  });

  // ── Helpers ──
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['deal-products', dealId] });
  }

  function recalcTotal(updatedItems: DealProduct[]) {
    const total = updatedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    onValueChange(total);
  }

  // ── CSRF token helper ──
  function getCsrfToken(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function csrfHeaders(): Record<string, string> {
    const token = getCsrfToken();
    return token ? { 'x-csrf-token': token } : {};
  }

  // ── Add item ──
  async function handleAddItem() {
    if (!newProductId || newQty <= 0 || newUnitPrice < 0) return;

    const lineTotal = computeLineTotal(newQty, newUnitPrice, newDiscount);
    const res = await fetch(`/api/v1/deals/${dealId}/products`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({
        productId: newProductId,
        quantity: newQty,
        unitPrice: newUnitPrice,
        discount: newDiscount,
        lineTotal,
      }),
    });

    if (res.ok) {
      await invalidate();
      const updated =
        (await queryClient.getQueryData<DealProduct[]>(['deal-products', dealId])) ?? [];
      recalcTotal(updated);
      setAddingRow(false);
      setNewProductId('');
      setNewQty(1);
      setNewUnitPrice(0);
      setNewDiscount(0);
    }
  }

  // ── Delete item ──
  async function handleDelete(itemId: string) {
    const res = await fetch(`/api/v1/deals/${dealId}/products/${itemId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: csrfHeaders(),
    });
    if (res.ok) {
      await invalidate();
      const updated =
        (await queryClient.getQueryData<DealProduct[]>(['deal-products', dealId])) ?? [];
      recalcTotal(updated);
    }
  }

  // ── Update item field ──
  async function handleUpdateItem(
    item: DealProduct,
    patch: Partial<Pick<DealProduct, 'quantity' | 'unitPrice' | 'discount'>>
  ) {
    const qty = patch.quantity ?? item.quantity;
    const unitPrice = patch.unitPrice ?? item.unitPrice;
    const discount = patch.discount ?? item.discount;
    const lineTotal = computeLineTotal(qty, unitPrice, discount);

    const res = await fetch(`/api/v1/deals/${dealId}/products/${item.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ quantity: qty, unitPrice, discount, lineTotal }),
    });

    if (res.ok) {
      await invalidate();
      const updated =
        (await queryClient.getQueryData<DealProduct[]>(['deal-products', dealId])) ?? [];
      recalcTotal(updated);
    }
  }

  const grandTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  if (loadingItems) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="pb-2 pr-3 font-medium text-gray-500">Produto</th>
              <th className="pb-2 px-2 font-medium text-gray-500 w-20">Qtd</th>
              <th className="pb-2 px-2 font-medium text-gray-500 w-28">Preço unit.</th>
              <th className="pb-2 px-2 font-medium text-gray-500 w-20">Desc. %</th>
              <th className="pb-2 px-2 font-medium text-gray-500 text-right w-28">Total</th>
              <th className="pb-2 pl-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-2 pr-3 text-gray-800">{item.productName}</td>

                {/* Quantity */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    disabled={somenteLeitura}
                    onChange={(e) => handleUpdateItem(item, { quantity: Number(e.target.value) })}
                    className="w-16 rounded border border-gray-200 px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Unit price */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={item.unitPrice}
                    disabled={somenteLeitura}
                    onChange={(e) => handleUpdateItem(item, { unitPrice: Number(e.target.value) })}
                    className="w-24 rounded border border-gray-200 px-1 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Discount */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.discount}
                    disabled={somenteLeitura}
                    onChange={(e) => handleUpdateItem(item, { discount: Number(e.target.value) })}
                    className="w-16 rounded border border-gray-200 px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Line total */}
                <td className="py-2 px-2 text-right font-medium text-gray-700">
                  {formatCurrency(item.lineTotal)}
                </td>

                {/* Delete */}
                <td className="py-2 pl-2">
                  {!somenteLeitura && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Remover item"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {/* Inline add row */}
            {addingRow && (
              <tr className="border-b border-blue-100 bg-blue-50/30">
                {/* Product select */}
                <td className="py-2 pr-3">
                  <select
                    value={newProductId}
                    onChange={(e) => {
                      const product = catalog.find((p) => p.id === e.target.value);
                      setNewProductId(e.target.value);
                      if (product) setNewUnitPrice(product.price);
                    }}
                    className="w-full rounded border border-gray-200 px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">Selecionar...</option>
                    {catalog.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Qty */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={1}
                    value={newQty}
                    onChange={(e) => setNewQty(Number(e.target.value))}
                    className="w-16 rounded border border-gray-200 px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Unit price */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={newUnitPrice}
                    onChange={(e) => setNewUnitPrice(Number(e.target.value))}
                    className="w-24 rounded border border-gray-200 px-1 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Discount */}
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newDiscount}
                    onChange={(e) => setNewDiscount(Number(e.target.value))}
                    className="w-16 rounded border border-gray-200 px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>

                {/* Preview total */}
                <td className="py-2 px-2 text-right text-gray-500 text-xs">
                  {formatCurrency(computeLineTotal(newQty, newUnitPrice, newDiscount))}
                </td>

                {/* Confirm / cancel */}
                <td className="py-2 pl-2">
                  <div className="flex gap-1">
                    <button
                      onClick={handleAddItem}
                      className="text-xs text-blue-600 font-medium hover:underline"
                    >
                      OK
                    </button>
                    <button
                      onClick={() => {
                        setAddingRow(false);
                        setNewProductId('');
                        setNewQty(1);
                        setNewUnitPrice(0);
                        setNewDiscount(0);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {somenteLeitura && (
        <p className="text-sm text-foreground">
          O valor deste negócio vem do Flow. Os produtos ficam só para leitura.
        </p>
      )}

      {/* Add button */}
      {!addingRow && !somenteLeitura && (
        <button
          onClick={() => setAddingRow(true)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 transition-colors font-medium"
        >
          <Plus size={14} />
          Adicionar item
        </button>
      )}

      {/* Grand total */}
      <div className="flex justify-end border-t border-gray-100 pt-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Total do negócio:</span>
          <span className="text-lg font-bold text-gray-900">{formatCurrency(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
