
export interface MenuOption {
  id: number;
  name: string;
  price: number;
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  options?: MenuOption[];
}

// Static restaurant menu
export const menu: MenuItem[] = [
  {
    id: 1,
    name: 'Pizza',
    price: 10,
    options: [
      { id: 1, name: 'Small', price: 10 },
      { id: 2, name: 'Large', price: 15 }
    ]
  },
  {
    id: 2,
    name: 'Burger',
    price: 8
  },
  {
    id: 3,
    name: 'Salad',
    price: 6
  },
  {
    id: 4,
    name: 'Pasta',
    price: 12
  },
  {
    id: 5,
    name: 'Soda',
    price: 3
  }
];

// Function to get formatted menu for display
export function getFormattedMenu(): string {
  return menu
    .map(item => {
      const baseItem = `${item.id}: ${item.name} ($${item.price})`;
      if (item.options) {
        const options = item.options
          .map(opt => `  ${opt.id}: ${opt.name} ($${opt.price})`)
          .join('\n');
        return `${baseItem}\n${options}`;
      }
      return baseItem;
    })
    .join('\n');
}

// Function to get formatted sub-menu for a specific item
export function getFormattedSubMenu(itemId: number): string | null {
  const item = menu.find(i => i.id === itemId);
  if (!item || !item.options) return null;
  return item.options
    .map(opt => `${opt.id}: ${opt.name} ($${opt.price})`)
    .join('\n');
}

// Function to get a menu item by ID
export function getMenuItem(itemId: number): MenuItem | undefined {
  return menu.find(item => item.id === itemId);
}

// Function to get a specific option for a menu item
export function getMenuOption(itemId: number, optionId: number): MenuOption | undefined {
  const item = menu.find(i => i.id === itemId);
  return item?.options?.find(opt => opt.id === optionId);
}