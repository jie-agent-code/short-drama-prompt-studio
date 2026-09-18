// 角色识别「出现顺序」逻辑的边界测试
import { protagonistFrom } from '../app/lib/prompt/scene-card.ts'

let pass = 0
let fail = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (ok) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + '\n       got=' + actual + ' expected=' + expected) }
}

// 单方角色
check('只有女主', protagonistFrom('女主走进房间').label, '女主')
check('只有男主', protagonistFrom('男主走进房间').label, '男主')
check('只有妻子', protagonistFrom('妻子在厨房做饭').label, '女主')
check('只有丈夫', protagonistFrom('丈夫在客厅抽烟').label, '男主')
check('只有男友', protagonistFrom('男友送她回家').label, '男主')
check('只有母亲', protagonistFrom('母亲抱着孩子').label, '女主')
check('无性别信息', protagonistFrom('两个人在广场对峙').label, '主角')

// 双方出现：谁先出现谁是主角
check('妻子在前→女主', protagonistFrom('妻子在雨夜发现丈夫背叛').label, '女主')
check('丈夫在前→男主', protagonistFrom('丈夫发现妻子藏了秘密').label, '男主')
check('男主在前→男主', protagonistFrom('男主看着女主离开').label, '男主')
check('女主在前→女主', protagonistFrom('女主推开男主的手').label, '女主')

// 代词一致性：代词必须跟随判定出的性别
check('妻子在前 代词=她', protagonistFrom('妻子发现丈夫背叛').pronoun, '她')
check('丈夫在前 代词=他', protagonistFrom('丈夫发现妻子背叛').pronoun, '他')

// 主角指称优先于零散代词
check('女主+后续他→女主', protagonistFrom('女主走进房间，他跟在后面').label, '女主')
check('男主+后续她→男主', protagonistFrom('男主走进房间，她跟在后面').label, '男主')

// 显式「主角」不带性别时不应被强行指定
check('主角+中性描述', protagonistFrom('主角站在广场中央').label, '主角')

console.log('')
console.log('角色识别顺序专项：' + pass + ' 通过 / ' + fail + ' 失败')
