CREATE UNIQUE INDEX "one_open_cash_session" ON "cash_sessions" USING btree ("status") WHERE "cash_sessions"."status" = 'abierta';--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "production_items_po_idx" ON "production_items" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "production_materials_po_idx" ON "production_materials" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "reservations_item_idx" ON "stock_reservations" USING btree ("order_item_id","active");--> statement-breakpoint
CREATE INDEX "reservations_order_idx" ON "stock_reservations" USING btree ("order_id","active");