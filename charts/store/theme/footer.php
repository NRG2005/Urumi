<?php defined('ABSPATH') || exit; ?>
</main>

<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <div>
        <a class="wordmark" href="<?php echo esc_url(home_url('/')); ?>">Urumi <span>Supply</span></a>
        <p><?php esc_html_e('Everyday essentials in honest materials. Designed to be worn often and kept for years.', 'urumi'); ?></p>
      </div>
      <nav aria-label="<?php esc_attr_e('Shop', 'urumi'); ?>">
        <h2><?php esc_html_e('Shop', 'urumi'); ?></h2>
        <ul>
          <li><a href="<?php echo esc_url(wc_get_page_permalink('shop')); ?>"><?php esc_html_e('All products', 'urumi'); ?></a></li>
          <?php foreach (urumi_categories() as $cat) : ?>
            <li><a href="<?php echo esc_url(get_term_link($cat)); ?>"><?php echo esc_html($cat->name); ?></a></li>
          <?php endforeach; ?>
        </ul>
      </nav>
      <nav aria-label="<?php esc_attr_e('Help', 'urumi'); ?>">
        <h2><?php esc_html_e('Help', 'urumi'); ?></h2>
        <ul>
          <li><a href="<?php echo esc_url(wc_get_cart_url()); ?>"><?php esc_html_e('Your bag', 'urumi'); ?></a></li>
          <li><a href="<?php echo esc_url(wc_get_checkout_url()); ?>"><?php esc_html_e('Checkout', 'urumi'); ?></a></li>
          <li><a href="<?php echo esc_url(wc_get_page_permalink('myaccount')); ?>"><?php esc_html_e('Your account', 'urumi'); ?></a></li>
        </ul>
      </nav>
    </div>
    <div class="site-footer__base">
      <span>&copy; <?php echo esc_html(wp_date('Y')); ?> Urumi Supply</span>
      <span><?php esc_html_e('A demo store for the Urumi MCP gateway.', 'urumi'); ?></span>
    </div>
  </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
