<?php
/**
 * Urumi Supply theme. Shop and product pages use WooCommerce's own templates
 * (wrapped by woocommerce.php); the home page is front-page.php.
 */

defined('ABSPATH') || exit;

add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets']);
    add_theme_support('woocommerce', [
        'thumbnail_image_width' => 640,
        'single_image_width'    => 1000,
        'product_grid'          => ['default_columns' => 3, 'default_rows' => 4],
    ]);
    add_theme_support('wc-product-gallery-lightbox');
    add_theme_support('wc-product-gallery-slider');
});

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('urumi-fonts', 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@400;500;600&display=swap', [], null);
    $deps = class_exists('WooCommerce') ? ['woocommerce-general'] : [];
    wp_enqueue_style('urumi', get_stylesheet_uri(), $deps, wp_get_theme()->get('Version'));
});

// Keep WooCommerce's base layout CSS; our stylesheet handles small screens itself.
add_filter('woocommerce_enqueue_styles', function ($styles) {
    unset($styles['woocommerce-smallscreen']);
    return $styles;
});

// The home page shows product cards too: give it WooCommerce's styling context.
add_filter('body_class', fn ($classes) => is_front_page() ? array_merge($classes, ['woocommerce']) : $classes);

add_filter('loop_shop_columns', fn () => 3);
add_filter('loop_shop_per_page', fn () => 12);
remove_action('woocommerce_sidebar', 'woocommerce_get_sidebar', 10);
remove_action('woocommerce_before_main_content', 'woocommerce_output_content_wrapper', 10);
remove_action('woocommerce_after_main_content', 'woocommerce_output_content_wrapper_end', 10);

// Products without a photo (e.g. one just created by the chat agent) get an on-brand placeholder.
add_filter('woocommerce_placeholder_img_src', fn () => get_theme_file_uri('placeholder.svg'));

// Wording: a bag, not a cart.
add_filter('woocommerce_product_single_add_to_cart_text', fn () => __('Add to bag', 'urumi'));
add_filter('woocommerce_product_add_to_cart_text', function ($text, $product) {
    return $product->is_purchasable() && $product->is_in_stock() && $product->is_type('simple') ? __('Add to bag', 'urumi') : $text;
}, 10, 2);
add_filter('woocommerce_sale_flash', fn () => '<span class="onsale">' . esc_html__('Sale', 'urumi') . '</span>');

// Reviews are noise in a demo catalogue with none; the description tab stays.
add_filter('woocommerce_product_tabs', function ($tabs) {
    unset($tabs['reviews']);
    return $tabs;
});
add_filter('woocommerce_output_related_products_args', fn ($args) => array_merge($args, ['posts_per_page' => 4, 'columns' => 4]));

/** Product categories for navigation (excluding the default "Uncategorized"). */
function urumi_categories(): array
{
    $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => true, 'orderby' => 'name']);
    if (is_wp_error($terms)) {
        return [];
    }
    $default = (int) get_option('default_product_cat');
    return array_values(array_filter($terms, fn ($t) => (int) $t->term_id !== $default));
}

/** The bag link, also returned as an AJAX fragment so the count updates after "Add to bag". */
function urumi_cart_link(): void
{
    $count = function_exists('WC') && WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
    printf(
        '<a class="cart-link" href="%1$s" aria-label="%2$s">%3$s <span class="cart-count" aria-hidden="true">%4$d</span></a>',
        esc_url(wc_get_cart_url()),
        esc_attr(sprintf(_n('Bag, %d item', 'Bag, %d items', $count, 'urumi'), $count)),
        esc_html__('Bag', 'urumi'),
        $count
    );
}

add_filter('woocommerce_add_to_cart_fragments', function ($fragments) {
    ob_start();
    urumi_cart_link();
    $fragments['a.cart-link'] = ob_get_clean();
    return $fragments;
});

/** Category filter pills above the shop grid. */
add_action('woocommerce_before_shop_loop', function () {
    $current = is_product_category() ? get_queried_object_id() : 0;
    echo '<nav aria-label="' . esc_attr__('Product categories', 'urumi') . '"><ul class="category-pills">';
    printf('<li><a href="%s"%s>%s</a></li>', esc_url(wc_get_page_permalink('shop')), $current ? '' : ' aria-current="page"', esc_html__('All', 'urumi'));
    foreach (urumi_categories() as $cat) {
        printf('<li><a href="%s"%s>%s</a></li>', esc_url(get_term_link($cat)), $current === (int) $cat->term_id ? ' aria-current="page"' : '', esc_html($cat->name));
    }
    echo '</ul></nav><div class="shop-toolbar">';
}, 5);
add_action('woocommerce_before_shop_loop', fn () => print('</div>'), 40);

/** Small, honest assurances under the add-to-bag button. */
add_action('woocommerce_single_product_summary', function () {
    echo '<ul class="product-assurances">'
        . '<li>' . esc_html__('Pay cash on delivery', 'urumi') . '</li>'
        . '<li>' . esc_html__('No delivery charge', 'urumi') . '</li>'
        . '</ul>';
}, 35);

/** Image for a category tile: the first product photo in that category. */
function urumi_category_image(WP_Term $cat): string
{
    $ids = wc_get_products(['category' => [$cat->slug], 'limit' => 1, 'return' => 'ids', 'status' => 'publish']);
    return $ids ? (string) get_the_post_thumbnail(reset($ids), 'woocommerce_thumbnail', ['loading' => 'lazy', 'alt' => '']) : '';
}

/** Render products with WooCommerce's own loop template, so cards match the shop exactly. */
function urumi_product_grid(array $args, int $columns = 4): void
{
    $products = wc_get_products(array_merge(['status' => 'publish', 'limit' => 4], $args));
    if (!$products) {
        return;
    }
    wc_set_loop_prop('columns', $columns);
    echo '<ul class="products columns-' . esc_attr($columns) . '">';
    foreach ($products as $product) {
        $GLOBALS['post'] = get_post($product->get_id());
        setup_postdata($GLOBALS['post']);
        wc_get_template_part('content', 'product');
    }
    echo '</ul>';
    wp_reset_postdata();
}
