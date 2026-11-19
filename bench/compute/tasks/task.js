function run(text) {
  const orders = JSON.parse(text);
  const byRegion = {};
  const byCustomer = {};
  let ordersWithMoreThan3Items = 0;
  for (const order of orders) {
    const items = order.items;
    if (items.length > 3) ordersWithMoreThan3Items++;
    let total = 0;
    for (const item of items) total += item.qty * item.price;
    byRegion[order.region] = (byRegion[order.region] || 0) + total;
    byCustomer[order.customer] = (byCustomer[order.customer] || 0) + total;
  }
  const cents = (x) => Math.round(x * 100) / 100;
  const revenueByRegion = {};
  for (const region of Object.keys(byRegion)) revenueByRegion[region] = cents(byRegion[region]);
  const topCustomers = Object.keys(byCustomer)
    .map((customer) => ({ customer, revenue: byCustomer[customer] }))
    .sort((a, b) => b.revenue - a.revenue || (a.customer < b.customer ? -1 : 1))
    .slice(0, 5)
    .map((entry) => ({ customer: entry.customer, revenue: cents(entry.revenue) }));
  return JSON.stringify({ revenueByRegion, topCustomers, ordersWithMoreThan3Items });
}
