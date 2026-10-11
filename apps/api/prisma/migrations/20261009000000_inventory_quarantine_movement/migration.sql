-- Add a QUARANTINE inventory-movement type.
--
-- WHY: when an order is cancelled *after* its goods have left the warehouse
-- (order status SHIPPING), the reserved units must not be released back to
-- sellable stock — physically they are in transit, so making them available
-- again would oversell stock the warehouse no longer holds. `releaseOrderReservations`
-- now converts those reservations into a blocked (quarantine) quantity and
-- records the move with this new movement type.
--
-- Additive only: appends one value to the `inventory_movements.type` enum. No
-- row is modified or removed.

ALTER TABLE `inventory_movements`
  MODIFY `type` ENUM('INBOUND', 'OUTBOUND', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'RETURN', 'QUARANTINE') NOT NULL;
