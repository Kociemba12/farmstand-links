import React from 'react';
import { View, Text, Pressable, Dimensions, StyleSheet, Image } from 'react-native';
import { Plus, Package, Star, Sparkles, Leaf, TrendingUp } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Product, PRODUCT_CATEGORY_LABELS, PRODUCT_UNIT_LABELS } from '@/lib/products-store';


const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Card dimensions - DoorDash style large cards
export const PRODUCT_CARD_WIDTH = SCREEN_WIDTH * 0.75;
export const PRODUCT_CARD_HEIGHT = 240;
export const PRODUCT_CARD_SPACING = 14;

// Stock status types
type StockStatus = 'in_stock' | 'low_stock' | 'sold_out';

// Badge types for products
type ProductBadge = 'popular' | 'seasonal' | 'new' | 'organic';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
  onAddPress?: () => void;
  index?: number;
  // Optional additional data
  rating?: number;
  reviewCount?: number;
  badges?: ProductBadge[];
  stockCount?: number;
  lowStockThreshold?: number;
}

// Determine stock status based on product data
const getStockStatus = (
  product: Product,
  stockCount?: number,
  lowStockThreshold: number = 3
): StockStatus => {
  if (!product.is_in_stock) return 'sold_out';
  if (stockCount !== undefined) {
    if (stockCount === 0) return 'sold_out';
    if (stockCount <= lowStockThreshold) return 'low_stock';
  }
  return 'in_stock';
};

// Stock status colors and labels
const STOCK_STATUS_CONFIG: Record<
  StockStatus,
  { bg: string; text: string; label: string }
> = {
  in_stock: { bg: '#E8F5E9', text: '#2E7D32', label: 'In Stock' },
  low_stock: { bg: '#FFF3E0', text: '#E65100', label: 'Low Stock' },
  sold_out: { bg: '#FFEBEE', text: '#C62828', label: 'Sold Out' },
};

// Badge config
const BADGE_CONFIG: Record<
  ProductBadge,
  { bg: string; text: string; label: string; icon: React.ReactNode }
> = {
  popular: {
    bg: '#FFF8E1',
    text: '#F9A825',
    label: 'Popular',
    icon: <TrendingUp size={10} color="#F9A825" />,
  },
  seasonal: {
    bg: '#E3F2FD',
    text: '#1976D2',
    label: 'Seasonal',
    icon: <Sparkles size={10} color="#1976D2" />,
  },
  new: {
    bg: '#F3E5F5',
    text: '#7B1FA2',
    label: 'New',
    icon: <Sparkles size={10} color="#7B1FA2" />,
  },
  organic: {
    bg: '#E8F5E9',
    text: '#388E3C',
    label: 'Organic',
    icon: <Leaf size={10} color="#388E3C" />,
  },
};

export function ProductCard({
  product,
  onPress,
  onAddPress,
  index = 0,
  rating,
  reviewCount,
  badges = [],
  stockCount,
  lowStockThreshold = 3,
}: ProductCardProps) {
  const scale = useSharedValue(1);
  const addButtonScale = useSharedValue(1);

  const stockStatus = getStockStatus(product, stockCount, lowStockThreshold);
  const isSoldOut = stockStatus === 'sold_out';
  const statusConfig = STOCK_STATUS_CONFIG[stockStatus];

  // Derive badges from product data
  const derivedBadges: ProductBadge[] = [...badges];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: isSoldOut ? 0.7 : 1,
  }));

  const addButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: addButtonScale.value }],
  }));

  const handlePressIn = () => {
    if (!isSoldOut) {
      scale.value = withSpring(0.97, { damping: 15 });
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15 });
  };

  const handlePress = () => {
    if (!isSoldOut) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  const handleAddPress = () => {
    if (isSoldOut) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addButtonScale.value = withSpring(1.2, { damping: 10 }, () => {
      addButtonScale.value = withSpring(1, { damping: 10 });
    });
    onAddPress?.();
  };

  return (
    <Animated.View
      entering={FadeIn.delay(index * 80).duration(400)}
      style={[styles.cardContainer, animatedStyle]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isSoldOut}
        style={styles.card}
      >
        {/* Image Section */}
        <View style={styles.imageContainer}>
          {product.photo_url ? (
            <Image
              source={{ uri: product.photo_url }}
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.noImagePlaceholder}>
              <Package size={40} color="#C4B5A4" />
              <Text style={styles.noImageText}>No photo</Text>
            </View>
          )}

          {/* Badges overlay on image */}
          {derivedBadges.length > 0 && (
            <View style={styles.badgesContainer}>
              {derivedBadges.slice(0, 2).map((badge) => {
                const config = BADGE_CONFIG[badge];
                return (
                  <View
                    key={badge}
                    style={[styles.badge, { backgroundColor: config.bg }]}
                  >
                    {config.icon}
                    <Text style={[styles.badgeText, { color: config.text }]}>
                      {config.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Add button */}
          {onAddPress && (
            <Animated.View style={[styles.addButtonContainer, addButtonAnimatedStyle]}>
              <Pressable
                onPress={handleAddPress}
                disabled={isSoldOut}
                style={[
                  styles.addButton,
                  isSoldOut && styles.addButtonDisabled,
                ]}
              >
                <Plus size={20} color={isSoldOut ? '#999' : '#FFF'} strokeWidth={2.5} />
              </Pressable>
            </Animated.View>
          )}

          {/* Sold out overlay */}
          {isSoldOut && (
            <View style={styles.soldOutOverlay}>
              <Text style={styles.soldOutOverlayText}>Sold Out</Text>
            </View>
          )}
        </View>

        {/* Info Section */}
        <View style={styles.infoContainer}>
          {/* Top row: Name and Price */}
          <View style={styles.nameRow}>
            <Text style={styles.productName} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={styles.productPrice}>
              ${product.price.toFixed(2)}
              <Text style={styles.priceUnit}>/{PRODUCT_UNIT_LABELS[product.unit]}</Text>
            </Text>
          </View>

          {/* Category */}
          <Text style={styles.categoryText}>
            {PRODUCT_CATEGORY_LABELS[product.category]}
          </Text>

          {/* Bottom row: Stock status and rating */}
          <View style={styles.bottomRow}>
            {/* Stock badge */}
            <View
              style={[
                styles.stockBadge,
                { backgroundColor: statusConfig.bg },
              ]}
            >
              <Text style={[styles.stockText, { color: statusConfig.text }]}>
                {statusConfig.label}
              </Text>
            </View>

            {/* Rating (if available) */}
            {rating !== undefined && rating > 0 && (
              <View style={styles.ratingContainer}>
                <Star size={12} color="#F9A825" fill="#F9A825" />
                <Text style={styles.ratingText}>
                  {rating.toFixed(1)}
                  {reviewCount !== undefined && reviewCount > 0 && (
                    <Text style={styles.reviewCountText}> ({reviewCount})</Text>
                  )}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    width: PRODUCT_CARD_WIDTH,
    marginRight: PRODUCT_CARD_SPACING,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: '100%',
    height: 140,
    position: 'relative',
    backgroundColor: '#F5F3F0',
  },
  productImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  noImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F3F0',
  },
  noImageText: {
    marginTop: 6,
    color: '#A9A9A9',
    fontSize: 12,
  },
  badgesContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  addButtonContainer: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOutOverlayText: {
    color: '#C62828',
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  infoContainer: {
    padding: 14,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  productName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    marginRight: 10,
    lineHeight: 20,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D5A3D',
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8B6F4E',
  },
  categoryText: {
    fontSize: 12,
    color: '#8B6F4E',
    marginBottom: 10,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  stockText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3D3D3D',
  },
  reviewCountText: {
    fontWeight: '400',
    color: '#8B6F4E',
  },
});

export default ProductCard;
