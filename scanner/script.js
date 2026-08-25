function updateUI() {
    const total = State.items.length;
    itemCount.textContent = total;
    
    const grouped = State.getGroupedItems();
    itemList.innerHTML = Object.entries(grouped).map(([sku, qty]) => `
      <li>
        <div class="item-info">
          <span><strong>${sku}</strong></span>
        </div>
        <div class="item-actions">
          <button class="qty-btn" onclick="handleUpdateQty('${sku}', -1)">-</button>
          <span><strong>${qty}</strong></span>
          <button class="qty-btn" onclick="handleUpdateQty('${sku}', 1)">+</button>
          <button class="remove-btn" onclick="handleRemoveItem('${sku}')">Remove</button>
        </div>
      </li>
    `).reverse().join('');

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const payload = State.getPayload();
      qrCodeGenerator.makeCode(payload);
    }, 400);
  }