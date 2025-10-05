// Test syntax file
class TestClass extends HTMLElement {
  static VERSION = '1.0.7';
  
  constructor() {
    super();
    console.log('Test class works');
  }
}

customElements.define('test-element', TestClass);