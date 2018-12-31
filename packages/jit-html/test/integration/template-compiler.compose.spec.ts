import { IContainer } from '@aurelia/kernel';
import {
  Aurelia,
  IDOM,
  ILifecycle,
  IRenderingEngine,
  LifecycleFlags,
  TemplateDefinition
} from '@aurelia/runtime';
import { RenderPlan } from '@aurelia/runtime-html';
import { expect } from 'chai';
import { baseSuite } from './template-compiler.base';
import { defineCustomElement, trimFull } from './util';

const spec = 'template-compiler.compose';

const suite = baseSuite.clone<
    /*a*/IContainer,
    /*b*/Aurelia,
    /*c*/ILifecycle,
    /*d*/HTMLElement, // host
    /*e*/any, // component
    /*f*/any, // subject
    /*g*/string, // subject bindable prop
    /*h*/string, // expected text
    /*i*/string // app markup
  >(spec);

// compose
suite.addDataSlot('f') // subject + expected text
  // Raw Template
  .addData('01').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    return {
      template: `<template>${msg}</template>`,
      build: { required: true, compiler: 'default' }
    };
  })
  // Raw Template (promise)
  .addData('02').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    return Promise.resolve({
      template: `<template>${msg}</template>`,
      build: { required: true, compiler: 'default' }
    });
  })
  // Raw Template (promise with delay)
  .addData('03').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    return Promise.resolve().then(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
              template: `<template>${msg}</template>`,
              build: { required: true, compiler: 'default' }
          });
        },         50);
      });
    });
  })
  // IViewFactory
  .addData('04').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    const engine = ctx.a.get(IRenderingEngine);
    const dom = ctx.a.get(IDOM);
    return engine.getViewFactory(dom, {
      template: `<template>${msg}</template>`,
      build: { required: true, compiler: 'default' }
    } as TemplateDefinition);
  })
  // IView
  .addData('05').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    const engine = ctx.a.get(IRenderingEngine);
    const dom = ctx.a.get(IDOM);
    return engine.getViewFactory(dom, {
      template: `<template>${msg}</template>`,
      build: { required: true, compiler: 'default' }
    } as TemplateDefinition).create();
  })
  // RenderPlan
  .addData('06').setFactory(ctx => {
    const dom = ctx.a.get(IDOM);
    const msg = ctx.h = 'Hello!';
    ctx.g = 'sub';
    return new RenderPlan(dom, `<div>${msg}</div>`, [], []);
  })
  // Raw Template (inline)
  .addData('07').setFactory(ctx => {
    const msg = ctx.h = 'Hello!';
    ctx.g = `{
      template: '<template>${msg}</template>',
      build: { required: true, compiler: 'default' }
    }`;
  });

suite.addDataSlot('i') // app markup
  .addData('01').setFactory(ctx =>
    `<template>
      <au-compose subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('02').setFactory(ctx =>
    `<template>
      <template as-element="au-compose" subject.bind="${ctx.g}"></template>
    </template>`)
  .addData('03').setFactory(ctx =>
    `<template>
      <au-compose repeat.for="i of 1" subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('04').setFactory(ctx =>
    `<template>
      <au-compose if.bind="true" subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('05').setFactory(ctx =>
    `<template>
      <div if.bind="false"></div>
      <au-compose else subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('06').setFactory(ctx =>
    `<template>
      <au-compose if.bind="true" repeat.for="i of 1" subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('07').setFactory(ctx =>
    `<template>
      <au-compose if.bind="true" repeat.for="i of 1" subject.bind="${ctx.g}"></au-compose>
    </template>`)
  .addData('08').setFactory(ctx =>
    `<template>
      <au-compose subject.bind="${ctx.g}" if.bind="true" repeat.for="i of 1"></au-compose>
    </template>`)
  .addData('09').setFactory(ctx =>
    `<template>
      <au-compose if.bind="true" subject.bind="${ctx.g}" repeat.for="i of 1"></au-compose>
    </template>`);

suite.addActionSlot('test')
  .addAsyncAction(null, async ctx => {
    const { a: container, b: au, c: lifecycle, d: host, f: subject, g: prop, h: expected, i: markup } = ctx;
    class App { public sub = null; }
    const $App = defineCustomElement('app', markup, App);
    const component = new $App();
    component.sub = subject;
    au.app({ host, component }).start();
    lifecycle.processFlushQueue(LifecycleFlags.none);
    if (subject instanceof Promise) {
      expect(trimFull(host.textContent)).to.equal('');
      await subject;
      expect(trimFull(host.textContent)).to.equal(expected);
    } else {
      expect(trimFull(host.textContent)).to.equal(expected);
    }
  });

suite.load();
suite.run();