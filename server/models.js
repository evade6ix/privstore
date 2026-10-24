import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const holdingSchema = new Schema({
  productId: { type: String, required: true, index: true },
  variantId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  variantTitle: { type: String, default: '' },
  sku: { type: String, default: '' },
  image: { type: String, default: '' },
  shopifyQty: { type: Number, default: 0 },
  availableQty: { type: Number, default: 0, min: 0 },
  defaultPrice: { type: Number, default: 0 },
  cutType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
  cutValue: { type: Number, default: 0, min: 0 },
  notes: { type: String, default: '' }
}, { timestamps: true });

const saleItemSchema = new Schema({
  variantId: { type: String, required: true },
  productId: { type: String, default: '' },
  title: { type: String, required: true },
  variantTitle: { type: String, default: '' },
  sku: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  standardPrice: { type: Number, default: 0 },
  pricePerUnit: { type: Number, required: true, min: 0 },
  cutType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
  cutValue: { type: Number, default: 0 },
  lineTotal: { type: Number, required: true },
  salespersonCut: { type: Number, required: true }
}, { _id: false });

const saleSchema = new Schema({
  saleNumber: { type: String, required: true, unique: true, index: true },
  items: { type: [saleItemSchema], required: true },
  customerName: { type: String, default: '' },
  paymentMethod: { type: String, enum: ['cash', 'etransfer', 'card', 'other'], default: 'cash' },
  notes: { type: String, default: '' },
  gross: { type: Number, required: true },
  salespersonCut: { type: Number, required: true },
  storeShare: { type: Number, required: true },
  status: { type: String, enum: ['completed', 'voided'], default: 'completed', index: true },
  voidedAt: Date
}, { timestamps: true });

const inventoryTxnSchema = new Schema({
  variantId: { type: String, required: true, index: true },
  type: { type: String, enum: ['TRANSFER_IN', 'SALE', 'RETURN_TO_STORE', 'ADJUSTMENT', 'SALE_VOID'], required: true },
  quantity: { type: Number, required: true },
  relatedSaleId: { type: Schema.Types.ObjectId, ref: 'Sale' },
  note: { type: String, default: '' }
}, { timestamps: true });

const settlementSchema = new Schema({
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  saleIds: [{ type: Schema.Types.ObjectId, ref: 'Sale' }],
  grossSales: { type: Number, required: true },
  salespersonCut: { type: Number, required: true },
  amountDue: { type: Number, required: true },
  status: { type: String, enum: ['open', 'paid'], default: 'open' },
  paidAt: Date,
  notes: { type: String, default: '' }
}, { timestamps: true });

export const Holding = model('Holding', holdingSchema);
export const Sale = model('Sale', saleSchema);
export const InventoryTransaction = model('InventoryTransaction', inventoryTxnSchema);
export const Settlement = model('Settlement', settlementSchema);
